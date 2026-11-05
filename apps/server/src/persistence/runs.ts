import type { Run, StoredRunEvent } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { RUN_OUTPOST_COLUMNS, RUN_OUTPOST_JOINS, toRun, type RunRow } from './rows.ts';

const FINISHED_STATUSES = ['succeeded', 'failed', 'cancelled', 'outcome_unknown'];

export async function getRun(db: Queryable, id: string): Promise<Run | null> {
  const { rows } = await db.query<RunRow>(
    `SELECT r.*, ${RUN_OUTPOST_COLUMNS} FROM runs r ${RUN_OUTPOST_JOINS} WHERE r.id = $1`,
    [id],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

export async function countActiveRuns(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM runs
     WHERE status IN ('queued', 'running', 'awaiting_approval')`,
  );
  return rows[0]?.count ?? 0;
}

export async function requestCancel(db: Queryable, id: string): Promise<Run | null> {
  await db.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM runs WHERE id = $1
       UNION ALL
       SELECT child.id FROM runs child JOIN tree ON child.parent_run_id = tree.id
     )
     UPDATE runs SET cancel_requested_at = COALESCE(cancel_requested_at, now())
     WHERE id IN (SELECT id FROM tree) AND status <> ALL($2::text[])`,
    [id, FINISHED_STATUSES],
  );
  return getRun(db, id);
}

export const RUN_EVENTS_PAGE = 1000;

export async function listRunEventsAfter(
  db: Queryable,
  runId: string,
  afterSeq: number,
): Promise<StoredRunEvent[]> {
  const { rows } = await db.query<{ seq: number; payload: StoredRunEvent['event'] }>(
    `SELECT seq, payload FROM run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq LIMIT ${RUN_EVENTS_PAGE}`,
    [runId, afterSeq],
  );
  return rows.map((row) => ({ seq: row.seq, event: row.payload }));
}
