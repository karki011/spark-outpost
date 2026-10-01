import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  type AgentPick,
  type ApprovalOption,
  type BudgetLimit,
  type CheckpointKind,
  type CheckpointPayload,
  type MergeConflict,
  type RunChange,
} from '@spark-outpost/contracts';
import {
  insertApproval,
  settleIfDue,
  settlePending,
  type NewApproval,
} from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import { autoContinueSeconds } from '../persistence/setup.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import type { Append } from '../workflow/agent-turn.ts';
import { APPROVAL_POLL_MS, APPROVAL_TIMEOUT_MS } from '../workflow/approval-gate.ts';
import { ApprovalWaiters, waitForApproval } from '../workflow/approval-waiters.ts';
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

export const RISKY_CARD_TITLE = 'Start this risky change?';

export function riskyCard(reason: string): CheckpointCard {
  return {
    kind: 'plan',
    title: RISKY_CARD_TITLE,
    payload: payload({ kind: 'plan', question: RISKY_CARD_TITLE, reason }),
    options: [allow(CHECKPOINT_OPTION.makeChange, 'Build it'), stopOption],
  };
}

function retryTarget(to: AgentPick | null): string {
  return to?.modelLabel ? ` with ${to.modelLabel}` : ' one tier up';
}

export function retryCard(
  from: AgentPick | null,
  to: AgentPick | null,
  reason: string,
): CheckpointCard {
  const question = `Retry${retryTarget(to)}?`;
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

export function verifyCard(
  from: AgentPick | null,
  to: AgentPick | null,
  reason: string,
): CheckpointCard {
  const title = 'Jev could not verify the change';
  return {
    kind: 'verify',
    title,
    payload: payload({
      kind: 'verify',
      question: `Finish as it is, or retry${retryTarget(to)}?`,
      reason,
      from,
      to,
      autoOption: CHECKPOINT_OPTION.finishUnverified,
    }),
    options: [
      allow(CHECKPOINT_OPTION.finishUnverified, 'Finish as it is'),
      allow(CHECKPOINT_OPTION.retry, 'Retry one tier up'),
      stopOption,
    ],
  };
}

export function acceptCard(
  files: readonly RunChange[],
  reason: string,
  fixLabel: string | null = null,
  laws: readonly string[] = [],
): CheckpointCard {
  return {
    kind: 'accept',
    title: 'Keep these changes?',
    payload: payload({
      kind: 'accept',
      question: 'Keep these changes?',
      reason,
      files: [...files],
      laws: [...laws],
    }),
    options: [
      allow(CHECKPOINT_OPTION.keep, 'Keep'),
      ...(fixLabel ? [reject(CHECKPOINT_OPTION.fixFindings, fixLabel)] : []),
      reject(CHECKPOINT_OPTION.fix, 'Ask for a fix'),
      reject(CHECKPOINT_OPTION.revert, 'Revert'),
    ],
  };
}

export function budgetCard(
  limit: BudgetLimit,
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

export function ownershipCard(agent: string, files: readonly string[]): CheckpointCard {
  const named = files.map((file) => `\`${file}\``).join(', ');
  const reason = `${agent} changed ${named}, which no piece owns.`;
  return {
    kind: 'ownership',
    title: `${agent} changed a file outside its piece`,
    payload: payload({
      kind: 'ownership',
      question: 'Keep it in the piece, revert it, or stop?',
      reason,
      agent,
      files: files.map((path) => ({ path, change: 'modified' as const })),
    }),
    options: [
      allow(CHECKPOINT_OPTION.keepInPiece, `Keep it in ${agent}'s piece`),
      reject(CHECKPOINT_OPTION.revertFile, 'Revert that file'),
      stopOption,
    ],
  };
}

export function piecesCard(question: string, reason: string, parallel: boolean): CheckpointCard {
  return {
    kind: 'pieces',
    title: question,
    payload: payload({ kind: 'pieces', question, reason }),
    options: [
      allow(CHECKPOINT_OPTION.makeChange, 'Build it'),
      ...(parallel ? [allow(CHECKPOINT_OPTION.buildInOrder, 'Build in order instead')] : []),
      allow(CHECKPOINT_OPTION.editPlan, 'Revise'),
      stopOption,
    ],
  };
}

const PR_SPLIT_TITLE = 'One PR or separate PRs?';

export function prSplitCard(pieces: readonly string[]): CheckpointCard {
  return {
    kind: 'pr_split',
    title: PR_SPLIT_TITLE,
    payload: payload({
      kind: 'pr_split',
      question: `${pieces.join(', ')} were built in their own worktrees. Ship them in one PR, or one PR each?`,
      reason: 'Pieces built in the shared tree always go in the main PR.',
      autoOption: CHECKPOINT_OPTION.onePr,
    }),
    options: [
      allow(CHECKPOINT_OPTION.onePr, 'One PR'),
      allow(CHECKPOINT_OPTION.separatePrs, 'Separate PRs'),
      allow(CHECKPOINT_OPTION.alwaysOnePr, 'Always one PR here'),
      allow(CHECKPOINT_OPTION.alwaysSeparatePrs, 'Always separate PRs here'),
    ],
  };
}

export const COMPACT_CARD_TITLE = 'This chat is almost full';

export function compactCard(reason: string): CheckpointCard {
  return {
    kind: 'compact',
    title: COMPACT_CARD_TITLE,
    payload: payload({
      kind: 'compact',
      question: 'Compact it before your message?',
      reason,
      autoOption: CHECKPOINT_OPTION.keepGoing,
    }),
    options: [
      allow(CHECKPOINT_OPTION.compactNow, 'Compact now'),
      allow(CHECKPOINT_OPTION.freshChat, 'Start a fresh chat with a summary'),
      reject(CHECKPOINT_OPTION.keepGoing, 'Keep going'),
    ],
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

export function checkpointApproval(
  runId: string,
  card: CheckpointCard,
  sequence: number,
): NewApproval {
  return {
    runId,
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
  };
}

export async function askCheckpoint(
  deps: CheckpointDeps,
  card: CheckpointCard,
  sequence: number,
): Promise<CheckpointAnswer> {
  const pending = await insertApproval(deps.db, {
    ...checkpointApproval(deps.runId, card, sequence),
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

export async function askCard(
  s: Session,
  card: CheckpointCard,
  fallbackSeconds: number | null = null,
): Promise<CheckpointAnswer> {
  await publish(s);
  s.checkpoints += 1;
  const seconds = card.payload.autoOption
    ? ((await autoContinueSeconds(s.deps.db, s.input.workspaceId)) ?? fallbackSeconds)
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
