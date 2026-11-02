import { expirePendingApprovals } from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import { findExpiredLeases, type Lease } from '../persistence/jobs.ts';
import { markUnreadAfterCrash } from '../persistence/member-messages.ts';
import { failRunningPieces, skipUnstartedPieces } from '../persistence/pieces.ts';
import { LeaseLostError, appendRunEvent } from '../persistence/run-events.ts';
import { runBackgroundWait } from '../persistence/subagents.ts';
import { runEvents, type RunIdentity } from './run-events.ts';

export const OUTCOME_UNKNOWN_MESSAGE =
  'The worker stopped while this run was in progress, so its outcome is unknown. Nothing was retried automatically.';

export const PIECE_OUTCOME_UNKNOWN = 'Outcome unknown: the worker stopped while this piece ran.';

export const PIECE_NOT_STARTED = 'Not started: the worker stopped before it.';

export const WAITING_OUTCOME_MESSAGE = `${OUTCOME_UNKNOWN_MESSAGE} It was waiting for your approval, so that action never ran.`;

export const BACKGROUND_OUTCOME_MESSAGE =
  'Spark stopped while the agent was waiting on background work. That work stopped with it, so its results never arrived. Nothing was retried automatically.';

export const SLEEP_OUTCOME_MESSAGE =
  'Spark stopped while the agent was sleeping until a wakeup. The wakeup stopped with it, so the agent did not continue. Nothing was retried automatically.';

async function interruptedMessage(db: Db, runId: string): Promise<string> {
  const background = await runBackgroundWait(db, runId);
  if (!background) return OUTCOME_UNKNOWN_MESSAGE;
  if (background.wakesAt !== undefined && background.agents + background.tasks === 0) {
    return SLEEP_OUTCOME_MESSAGE;
  }
  return BACKGROUND_OUTCOME_MESSAGE;
}

export async function recoverExpiredLeases(db: Db): Promise<number> {
  const expired = await findExpiredLeases(db);
  let recovered = 0;
  for (const lease of expired) {
    if (await markOutcomeUnknown(db, lease)) recovered += 1;
  }
  if (recovered > 0) {
    await failRunningPieces(db, PIECE_OUTCOME_UNKNOWN);
    await skipUnstartedPieces(db, PIECE_NOT_STARTED);
  }
  return recovered;
}

async function markOutcomeUnknown(db: Db, lease: Lease): Promise<boolean> {
  try {
    const started = await hasStarted(db, lease.runId);
    if (!started) {
      const identity = await runIdentity(db, lease.runId);
      await appendRunEvent(db, lease, runEvents.started(identity), {
        expectExpired: true,
      });
    }
    const expired = await expirePendingApprovals(db, lease.runId, 'recovery');
    const message =
      expired > 0 ? WAITING_OUTCOME_MESSAGE : await interruptedMessage(db, lease.runId);
    await appendRunEvent(db, lease, runEvents.error(message, 'outcome_unknown'), {
      expectExpired: true,
      transition: { status: 'outcome_unknown', error: message },
    });
    await markUnreadAfterCrash(db, lease.runId);
    return true;
  } catch (error) {
    if (error instanceof LeaseLostError) return false;
    throw error;
  }
}

async function hasStarted(db: Db, runId: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM run_events WHERE run_id = $1 LIMIT 1', [
    runId,
  ]);
  return rowCount === 1;
}

async function runIdentity(db: Db, runId: string): Promise<RunIdentity> {
  const { rows } = await db.query<{ conversation_id: string; parent_run_id: string | null }>(
    'SELECT conversation_id, parent_run_id FROM runs WHERE id = $1',
    [runId],
  );
  const { conversation_id: threadId, parent_run_id: parentRunId } = rows[0]!;
  return { runId, threadId, ...(parentRunId ? { parentRunId } : {}) };
}
