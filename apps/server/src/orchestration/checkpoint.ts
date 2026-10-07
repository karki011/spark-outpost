import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  type ApprovalOption,
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

export type ChangedLines = CheckpointPayload['lines'];

export function acceptCard(
  files: readonly RunChange[],
  reason: string,
  fixLabel: string | null = null,
  laws: readonly string[] = [],
  lines: ChangedLines = null,
  outsidePlan: readonly string[] = [],
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
      outsidePlan: [...outsidePlan],
      lines,
    }),
    options: [
      allow(CHECKPOINT_OPTION.keep, 'Keep'),
      ...(fixLabel ? [reject(CHECKPOINT_OPTION.fixFindings, fixLabel)] : []),
      reject(CHECKPOINT_OPTION.fix, 'Ask for a fix'),
      reject(CHECKPOINT_OPTION.revert, 'Revert'),
    ],
  };
}

export const COMPACT_CARD_TITLE = 'This chat is almost full';

export function compactCard(reason: string, askAgainAt: number): CheckpointCard {
  return {
    kind: 'compact',
    title: COMPACT_CARD_TITLE,
    payload: payload({
      kind: 'compact',
      question: 'Compact it before your message?',
      reason,
      autoOption: CHECKPOINT_OPTION.keepGoing,
      askAgainAt,
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
