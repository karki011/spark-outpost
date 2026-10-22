import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  type ApprovalOption,
  type CheckpointKind,
  type CheckpointPayload,
  type RunChange,
} from '@spark-outpost/contracts';
import {
  insertApproval,
  settleIfDue,
  settlePending,
  type NewApproval,
} from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import type { Append } from './agent-turn.ts';
import type { ParkForUser } from './background-parking.ts';
import { waitForApproval, type ApprovalWaiters } from './approval-waiters.ts';
import { runEvents } from './run-events.ts';

export const allowOption = (optionId: string, name: string): ApprovalOption => ({
  optionId,
  name,
  kind: 'allow_once',
});
export const rejectOption = (optionId: string, name: string): ApprovalOption => ({
  optionId,
  name,
  kind: 'reject_once',
});

export interface CheckpointCard {
  kind: CheckpointKind;
  title: string;
  payload: CheckpointPayload;
  options: ApprovalOption[];
}

export function cardPayload(
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
    payload: cardPayload({
      kind: 'accept',
      question: 'Keep these changes?',
      reason,
      files: [...files],
      laws: [...laws],
      outsidePlan: [...outsidePlan],
      lines,
    }),
    options: [
      allowOption(CHECKPOINT_OPTION.keep, 'Keep'),
      ...(fixLabel ? [rejectOption(CHECKPOINT_OPTION.fixFindings, fixLabel)] : []),
      rejectOption(CHECKPOINT_OPTION.fix, 'Ask for a fix'),
      rejectOption(CHECKPOINT_OPTION.revert, 'Revert'),
    ],
  };
}

export const COMPACT_CARD_TITLE = 'This chat is almost full';

export function compactCard(reason: string, askAgainAt: number): CheckpointCard {
  return {
    kind: 'compact',
    title: COMPACT_CARD_TITLE,
    payload: cardPayload({
      kind: 'compact',
      question: 'Compact it before your message?',
      reason,
      autoOption: CHECKPOINT_OPTION.keepGoing,
      askAgainAt,
    }),
    options: [
      allowOption(CHECKPOINT_OPTION.compactNow, 'Compact now'),
      allowOption(CHECKPOINT_OPTION.freshChat, 'Start a fresh chat with a summary'),
      rejectOption(CHECKPOINT_OPTION.keepGoing, 'Keep going'),
    ],
  };
}

export interface CheckpointDeps {
  db: Db;
  runId: string;
  append: Append;
  waiters: ApprovalWaiters;
  signal: AbortSignal;
  timeoutMs: number;
  pollMs: number;
  autoContinueMs?: number | null;
  park?: ParkForUser | undefined;
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
  const unpark = deps.park?.();
  const result = await waitForApproval(pending.id, {
    ...deps,
    settleDue: autoOption ? () => settleIfDue(deps.db, pending.id, autoOption) : undefined,
  }).finally(unpark);
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
