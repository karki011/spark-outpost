import { CHECKPOINT_OPTION, type MergeConflict } from '@spark-outpost/contracts';
import { autoContinueSeconds } from '../persistence/setup.ts';
import { APPROVAL_POLL_MS, APPROVAL_TIMEOUT_MS } from '../workflow/approval-gate.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import {
  allowOption,
  askCheckpoint,
  cardPayload,
  rejectOption,
  type CheckpointAnswer,
  type CheckpointCard,
} from '../workflow/kept-record.ts';
import { publish, type Session } from './session.ts';

export {
  acceptCard,
  checkpointApproval,
  type ChangedLines,
  type CheckpointCard,
} from '../workflow/kept-record.ts';

export function mergeConflictCard(conflict: MergeConflict, reason: string): CheckpointCard {
  const { first, second } = conflict;
  const question = 'Which version should be kept?';
  return {
    kind: 'merge_conflict',
    title: reason,
    payload: cardPayload({ kind: 'merge_conflict', question, reason, conflict }),
    options: [
      allowOption(CHECKPOINT_OPTION.keepFirst, `Keep ${first}`),
      allowOption(CHECKPOINT_OPTION.keepSecond, `Keep ${second}'s`),
      rejectOption(CHECKPOINT_OPTION.stop, 'Stop'),
    ],
  };
}

export class CheckpointTimeout extends Error {}

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
