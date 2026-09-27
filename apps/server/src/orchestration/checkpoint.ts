import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  clarifyOptionId,
  depthSchema,
  type AgentPick,
  type ApprovalOption,
  type CheckpointKind,
  type CheckpointPayload,
  type Depth,
  type MergeConflict,
  type PlanEntry,
  type RunChange,
  type TransitionNext,
} from '@spark-outpost/contracts';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import { insertApproval, settleIfDue, settlePending } from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import { autoContinueSeconds } from '../persistence/setup.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import type { Append } from '../workflow/agent-turn.ts';
import { waitForApproval } from '../workflow/approval-waiters.ts';
import { APPROVAL_POLL_MS, APPROVAL_TIMEOUT_MS } from '../workflow/approval-gate.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { runEvents } from '../workflow/run-events.ts';
import { publish, type Session } from './session.ts';

const allow = (optionId: string, name: string): ApprovalOption => ({
  optionId,
  name,
  kind: 'allow_once',
});
const reject = (optionId: string, name: string): ApprovalOption => ({
  optionId,
  name,
  kind: 'reject_once',
});
const stopOption = reject(CHECKPOINT_OPTION.stop, 'Stop');

export interface CheckpointCard {
  kind: CheckpointKind;
  title: string;
  payload: CheckpointPayload;
  options: ApprovalOption[];
  depths: Depth[];
}

const DEPTH_CHOICES: Record<Depth, string> = {
  direct: 'Just answer; change nothing',
  execute: 'Make the change directly',
  plan_execute: 'Plan first, then make the change',
  plan_execute_review: 'Plan, make the change, then have it reviewed',
};

export function clarifyDepths(response: SystemOneResponse | null, fallback: Depth): Depth[] {
  const answer = response?.answers.depth;
  if (answer?.type !== 'choice') return [fallback];
  const ranked = Object.entries(answer.probabilities)
    .sort(([, a], [, b]) => b - a)
    .flatMap(([id]) => {
      const depth = depthSchema.safeParse(id);
      return depth.success ? [depth.data] : [];
    });
  return ranked.length > 0 ? ranked.slice(0, 3) : [fallback];
}

function payload(
  partial: Partial<CheckpointPayload> & Pick<CheckpointPayload, 'kind' | 'question' | 'reason'>,
) {
  return checkpointPayloadSchema.parse(partial);
}

export function clarifyCard(depths: readonly Depth[], reason: string): CheckpointCard {
  const choices = depths.map((depth) => DEPTH_CHOICES[depth]);
  return {
    kind: 'clarify',
    title: 'How should this be handled?',
    payload: payload({ kind: 'clarify', question: 'How should this be handled?', reason, choices }),
    options: [
      ...depths.map((depth, index) => allow(clarifyOptionId(index), DEPTH_CHOICES[depth])),
      allow(CHECKPOINT_OPTION.answer, 'Answer in your own words'),
      allow(CHECKPOINT_OPTION.clarifyRules, 'Let the rules decide'),
      stopOption,
    ],
    depths: [...depths],
  };
}

export function planCard(
  plan: readonly PlanEntry[],
  planVersion: number | null,
  reason: string,
): CheckpointCard {
  return {
    kind: 'plan',
    title: `Approve the plan${planVersion ? ` v${planVersion}` : ''}`,
    payload: payload({
      kind: 'plan',
      question: 'Approve the plan before any edits?',
      reason,
      plan: [...plan],
      planVersion,
    }),
    options: [
      allow(CHECKPOINT_OPTION.approvePlan, 'Approve'),
      reject(CHECKPOINT_OPTION.editPlan, 'Edit'),
      stopOption,
    ],
    depths: [],
  };
}

export function retryCard(
  suggestion: TransitionNext | null,
  from: AgentPick | null,
  to: AgentPick | null,
  reason: string,
): CheckpointCard {
  const reviewing = suggestion === 'review';
  const question = reviewing
    ? `Have the change reviewed${to ? ` by ${to.modelLabel ?? to.provider}` : ''}?`
    : `Retry${to?.modelLabel ? ` with ${to.modelLabel}` : ' one tier up'}?`;
  return {
    kind: 'retry',
    title: question,
    payload: payload({ kind: 'retry', question, reason, from, to }),
    options: [
      allow(CHECKPOINT_OPTION.retry, reviewing ? 'Review' : 'Retry'),
      reject(CHECKPOINT_OPTION.finish, reviewing ? 'Skip review' : 'Finish here'),
      stopOption,
    ],
    depths: [],
  };
}

const EXCERPT_MAX = 300;

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function agentQuestion(text: string): string | null {
  return lines(text).findLast((line) => line.endsWith('?')) ?? null;
}

export function agentExcerpt(text: string): string {
  const excerpt = agentQuestion(text) ?? lines(text).at(-1) ?? '';
  return excerpt.length > EXCERPT_MAX ? `${excerpt.slice(0, EXCERPT_MAX - 1)}…` : excerpt;
}

export function waitingLine(agent: string, blocked: boolean, excerpt: string): string {
  const said = blocked ? `${agent} says it's blocked` : `${agent} is waiting for your input`;
  return excerpt ? `${said}: ${excerpt}` : `${said}.`;
}

export function needsInputCard(agent: string, blocked: boolean, text: string): CheckpointCard {
  const question = 'How should it continue?';
  return {
    kind: 'clarify',
    title: `${agent} needs your input`,
    payload: payload({
      kind: 'clarify',
      question,
      reason: waitingLine(agent, blocked, agentExcerpt(text)),
      agent,
    }),
    options: [
      allow(CHECKPOINT_OPTION.answer, `Answer ${agent}`),
      allow(CHECKPOINT_OPTION.clarifyRules, 'Let the rules continue'),
      stopOption,
    ],
    depths: [],
  };
}

export function stuckCard(agent: string, reason: string): CheckpointCard {
  const title = `${agent} looks stuck`;
  return {
    kind: 'stuck',
    title,
    payload: payload({
      kind: 'stuck',
      question: 'How should it continue?',
      reason: `${title}: ${reason}.`,
      agent,
      autoOption: CHECKPOINT_OPTION.letContinue,
    }),
    options: [
      allow(CHECKPOINT_OPTION.nudge, `Nudge ${agent}`),
      allow(CHECKPOINT_OPTION.letContinue, 'Let it continue'),
      stopOption,
    ],
    depths: [],
  };
}

export function acceptCard(files: readonly RunChange[], reason: string): CheckpointCard {
  return {
    kind: 'accept',
    title: 'Keep these changes?',
    payload: payload({
      kind: 'accept',
      question: 'Keep these changes?',
      reason,
      files: [...files],
    }),
    options: [
      allow(CHECKPOINT_OPTION.keep, 'Keep'),
      reject(CHECKPOINT_OPTION.fix, 'Ask for a fix'),
      reject(CHECKPOINT_OPTION.revert, 'Revert'),
    ],
    depths: [],
  };
}

export function budgetCard(
  limit: 'time' | 'tool_calls' | 'cost',
  used: number,
  allowed: number,
  reason: string,
): CheckpointCard {
  return {
    kind: 'budget',
    title: 'Continue past the budget?',
    payload: payload({
      kind: 'budget',
      question: 'Continue past the budget?',
      reason,
      budget: { limit, used, allowed },
    }),
    options: [allow(CHECKPOINT_OPTION.continueBudget, 'Continue'), stopOption],
    depths: [],
  };
}

export function mergeConflictCard(conflict: MergeConflict, reason: string): CheckpointCard {
  const { first, second } = conflict;
  const question = 'Which change should be kept?';
  return {
    kind: 'merge_conflict',
    title: reason,
    payload: payload({ kind: 'merge_conflict', question, reason, conflict }),
    options: [
      allow(CHECKPOINT_OPTION.keepFirst, `Keep ${first}'s`),
      allow(CHECKPOINT_OPTION.keepSecond, `Keep ${second}'s`),
      allow(CHECKPOINT_OPTION.reconcile, 'Ask a Builder to reconcile'),
      stopOption,
    ],
    depths: [],
  };
}

export class CheckpointTimeout extends Error {}

export interface CheckpointDeps {
  db: Db;
  runId: string;
  append: Append;
  waiters: ApprovalWaiters;
  signal: AbortSignal;
  timeoutMs: number;
  pollMs: number;
  autoContinueMs?: number | null;
}

export type CheckpointAnswer =
  | { type: 'answered'; optionId: string; note: string | null }
  | { type: 'stopped' }
  | { type: 'timeout' };

async function emit(deps: CheckpointDeps, ...args: Parameters<Append>): Promise<void> {
  try {
    await deps.append(...args);
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
  }
}

export async function askCheckpoint(
  deps: CheckpointDeps,
  card: CheckpointCard,
  sequence: number,
): Promise<CheckpointAnswer> {
  const pending = await insertApproval(deps.db, {
    runId: deps.runId,
    toolCallId: `checkpoint:${card.kind}:${sequence}`,
    rpcId: null,
    kind: card.kind,
    title: card.title,
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      checkpoint: card.payload,
    },
    options: card.options,
    reason: card.payload.reason,
    autoContinueMs: card.payload.autoOption ? (deps.autoContinueMs ?? null) : null,
  });
  await deps.append(runEvents.approvalRequested(pending), {
    transition: { status: 'awaiting_approval' },
  });
  const autoOption = pending.autoContinueAt ? card.payload.autoOption : null;
  const result = await waitForApproval(pending.id, {
    ...deps,
    settleDue: autoOption ? () => settleIfDue(deps.db, pending.id, autoOption) : undefined,
  });
  if (result === 'aborted' || result === 'timeout') {
    const settled = await settlePending(deps.db, pending.id, {
      status: result === 'aborted' ? 'cancelled' : 'expired',
      decidedBy: result === 'aborted' ? 'stop' : 'timeout',
      optionId: null,
    });
    if (settled) await emit(deps, runEvents.approvalDecided(settled));
    return { type: result === 'aborted' ? 'stopped' : 'timeout' };
  }
  await emit(deps, runEvents.approvalDecided(result), { transition: { status: 'running' } });
  if (result.status === 'cancelled' || result.status === 'expired') return { type: 'stopped' };
  return {
    type: 'answered',
    optionId: result.decisionOptionId ?? CHECKPOINT_OPTION.stop,
    note: result.note ?? null,
  };
}

export async function askCard(s: Session, card: CheckpointCard): Promise<CheckpointAnswer> {
  await publish(s);
  s.checkpoints += 1;
  const seconds = card.payload.autoOption
    ? await autoContinueSeconds(s.deps.db, s.input.workspaceId)
    : null;
  return askCheckpoint(
    {
      db: s.deps.db,
      runId: s.lease.runId,
      append: s.append,
      waiters: s.deps.approvalWaiters ?? new ApprovalWaiters(),
      signal: s.control.signal,
      timeoutMs: s.deps.checkpointTimeoutMs ?? s.deps.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
      pollMs: s.deps.approvalPollMs ?? APPROVAL_POLL_MS,
      autoContinueMs: seconds === null ? null : seconds * 1000,
    },
    card,
    s.checkpoints,
  );
}

export function depthFromClarify(
  card: CheckpointCard,
  optionId: string,
  rules: Depth,
): Depth | null {
  if (optionId === CHECKPOINT_OPTION.stop) return null;
  if (optionId === CHECKPOINT_OPTION.clarifyRules || optionId === CHECKPOINT_OPTION.answer) {
    return rules;
  }
  const index = card.options.findIndex((option) => option.optionId === optionId);
  return card.depths[index] ?? rules;
}

export function clarifiedRequest(request: string, answer: string): string {
  return `${request}\n\nThe user clarified: ${answer}`;
}
