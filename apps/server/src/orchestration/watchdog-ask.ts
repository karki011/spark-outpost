import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import {
  hasPendingApproval,
  insertApproval,
  settleIfDue,
  settlePending,
} from '../persistence/approvals.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { autoContinueSeconds } from '../persistence/setup.ts';
import type { Append } from '../workflow/agent-turn.ts';
import { APPROVAL_POLL_MS, APPROVAL_TIMEOUT_MS } from '../workflow/approval-gate.ts';
import { ApprovalWaiters, waitForApproval } from '../workflow/approval-waiters.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { CheckpointCard } from './checkpoint.ts';
import { publish, type Session } from './session.ts';

export type StuckAnswer = 'nudge' | 'continue' | 'stop' | 'moved_on';

async function emit(s: Session, ...args: Parameters<Append>): Promise<void> {
  try {
    await s.append(...args);
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
  }
}

function answerOf(optionId: string | null): StuckAnswer {
  if (optionId === CHECKPOINT_OPTION.nudge) return 'nudge';
  if (optionId === CHECKPOINT_OPTION.stop) return 'stop';
  return 'continue';
}

export async function askStuck(
  s: Session,
  card: CheckpointCard,
  memberEnded: AbortSignal,
): Promise<StuckAnswer> {
  s.checkpoints += 1;
  const sequence = s.checkpoints;
  const db = s.deps.db;
  const seconds = await autoContinueSeconds(db, s.input.workspaceId);
  const pending = await insertApproval(db, {
    runId: s.lease.runId,
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
    autoContinueMs: seconds === null ? null : seconds * 1000,
  });
  await s.append(runEvents.approvalRequested(pending), {
    transition: { status: 'awaiting_approval' },
  });
  await publish(s);
  const result = await waitForApproval(pending.id, {
    db,
    waiters: s.deps.approvalWaiters ?? new ApprovalWaiters(),
    signal: AbortSignal.any([s.control.signal, memberEnded]),
    timeoutMs: s.deps.checkpointTimeoutMs ?? s.deps.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
    pollMs: s.deps.approvalPollMs ?? APPROVAL_POLL_MS,
    settleDue: pending.autoContinueAt
      ? () => settleIfDue(db, pending.id, CHECKPOINT_OPTION.letContinue)
      : undefined,
  });
  const stopping = s.control.signal.aborted;
  if (result === 'aborted' || result === 'timeout') {
    const settled = await settlePending(db, pending.id, {
      status: result === 'timeout' ? 'expired' : 'cancelled',
      decidedBy: stopping ? 'stop' : result === 'timeout' ? 'timeout' : 'policy',
      optionId: null,
    });
    if (settled) await emit(s, runEvents.approvalDecided(settled), await resumed(s, stopping));
    return 'moved_on';
  }
  await emit(s, runEvents.approvalDecided(result), await resumed(s, stopping));
  if (result.status === 'cancelled' || result.status === 'expired') return 'moved_on';
  return answerOf(result.decisionOptionId ?? null);
}

async function resumed(s: Session, stopping: boolean) {
  if (stopping || (await hasPendingApproval(s.deps.db, s.lease.runId))) return undefined;
  return { transition: { status: 'running' as const } };
}
