import type { Run, StoredRunEvent } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { toRun, type RunRow } from './rows.ts';

export async function getRun(db: Queryable, id: string): Promise<Run | null> {
  const { rows } = await db.query<RunRow>('SELECT * FROM runs WHERE id = $1', [id]);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function requestCancel(db: Queryable, id: string): Promise<Run | null> {
  const { rows } = await db.query<RunRow>(
    `UPDATE runs SET cancel_requested_at = COALESCE(cancel_requested_at, now())
     WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

export async function listRunEventsAfter(
  db: Queryable,
  runId: string,
  afterSeq: number,
): Promise<StoredRunEvent[]> {
  const { rows } = await db.query<{ seq: number; payload: StoredRunEvent['event'] }>(
    'SELECT seq, payload FROM run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq LIMIT 1000',
    [runId, afterSeq],
  );
  return rows.map((row) => ({ seq: row.seq, event: row.payload }));
}
