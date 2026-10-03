import { isTerminalRunStatus, type Run } from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { insertRunEvent } from '../persistence/run-events.ts';
import { getRun, requestCancel } from '../persistence/runs.ts';
import { runEvents } from './run-events.ts';

export type StopOutcome = 'stopping' | 'stopped' | 'already_finished';

export interface StopResult {
  run: Run;
  outcome: StopOutcome;
}

export async function stopRun(db: Db, runId: string): Promise<StopResult | null> {
  const before = await getRun(db, runId);
  if (!before) return null;
  if (isTerminalRunStatus(before.status)) return { run: before, outcome: 'already_finished' };
  await requestCancel(db, runId);
  await cancelUnclaimed(db, runId);
  const run = (await getRun(db, runId)) ?? before;
  return { run, outcome: isTerminalRunStatus(run.status) ? 'stopped' : 'stopping' };
}

async function cancelUnclaimed(db: Db, runId: string): Promise<void> {
  await withTransaction(db, async (client) => {
    const job = await client.query(
      `UPDATE jobs SET status = 'done', lease_token = NULL, lease_expires_at = NULL,
         updated_at = now()
       WHERE run_id = $1 AND status = 'queued'
         AND EXISTS (SELECT 1 FROM runs WHERE id = $1 AND status = 'queued')
       RETURNING id`,
      [runId],
    );
    if (job.rowCount !== 1) return;
    const { rows } = await client.query<{ conversation_id: string }>(
      `UPDATE runs SET status = 'cancelled', finished_at = now()
       WHERE id = $1 RETURNING conversation_id`,
      [runId],
    );
    const threadId = rows[0]!.conversation_id;
    await insertRunEvent(client, runId, runEvents.cancelled({ runId, threadId }));
    await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [threadId]);
    await client.query(`SELECT pg_notify('run_events', $1)`, [runId]);
  });
}
