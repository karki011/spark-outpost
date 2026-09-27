import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  type AgentPick,
  type ApprovalOption,
  type CheckpointKind,
  type CheckpointPayload,
  type MergeConflict,
  type RunChange,
} from '@spark-outpost/contracts';
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
}

function payload(
  partial: Partial<CheckpointPayload> & Pick<CheckpointPayload, 'kind' | 'question' | 'reason'>,
) {
  return checkpointPayloadSchema.parse(partial);
}

export function answerOrBuildCard(reason: string): CheckpointCard {
  const question = 'Answer, or change the code?';
  return {
    kind: 'clarify',
    title: question,
    payload: payload({ kind: 'clarify', question, reason }),
    options: [
      allow(CHECKPOINT_OPTION.justAnswer, 'Just answer; change nothing'),
      allow(CHECKPOINT_OPTION.makeChange, 'Make the change'),
      stopOption,
    ],
  };
}

export function retryCard(
  from: AgentPick | null,
  to: AgentPick | null,
  reason: string,
): CheckpointCard {
  const question = `Retry${to?.modelLabel ? ` with ${to.modelLabel}` : ' one tier up'}?`;
  return {
    kind: 'retry',
    title: question,
    payload: payload({
      kind: 'retry',
      question,
      reason,
      from,
      to,
      autoOption: CHECKPOINT_OPTION.stopReport,
    }),
    options: [
      allow(CHECKPOINT_OPTION.retry, 'Retry'),
      reject(CHECKPOINT_OPTION.stopReport, 'Stop and report'),
    ],
  };
}

export function stuckCard(agent: string, reason: string): CheckpointCard {
  const title = `${agent} was repeating itself`;
  return {
    kind: 'stuck',
    title,
    payload: payload({
      kind: 'stuck',
      question: 'Continue, or stop and report?',
      reason: `${reason}.`,
      agent,
      autoOption: CHECKPOINT_OPTION.stopReport,
    }),
    options: [
      allow(CHECKPOINT_OPTION.continueStuck, `Continue ${agent}`),
      reject(CHECKPOINT_OPTION.stopReport, 'Stop and report'),
    ],
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
  };
}

export function mergeConflictCard(conflict: MergeConflict, reason: string): CheckpointCard {
  const { first, second } = conflict;
  const question = 'Which version should be kept?';
  return {
    kind: 'merge_conflict',
    title: reason,
    payload: payload({ kind: 'merge_conflict', question, reason, conflict }),
    options: [
      allow(CHECKPOINT_OPTION.keepFirst, `Keep ${first}`),
      allow(CHECKPOINT_OPTION.keepSecond, `Keep ${second}'s`),
      stopOption,
    ],
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

export function clarifiedRequest(request: string, answer: string): string {
  return `${request}\n\nThe user clarified: ${answer}`;
}
