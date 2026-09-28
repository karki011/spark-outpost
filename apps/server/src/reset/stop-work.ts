import type { Db } from '../persistence/db.ts';

const FINISHED_RUN_STATES = ['succeeded', 'failed', 'cancelled', 'outcome_unknown'];
const POLL_MS = 100;

async function leasedJobCount(db: Db): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM jobs WHERE status = 'leased' AND lease_expires_at > now()`,
  );
  return rows[0]?.count ?? 0;
}

export async function stopActiveWork(db: Db, settleMs: number): Promise<number> {
  await db.query(
    `UPDATE jobs SET status = 'failed', last_error = 'Spark Outpost was reset.', updated_at = now()
     WHERE status = 'queued'`,
  );
  await db.query(
    `UPDATE runs SET cancel_requested_at = COALESCE(cancel_requested_at, now())
     WHERE status <> ALL($1::text[])`,
    [FINISHED_RUN_STATES],
  );
  const deadline = Date.now() + settleMs;
  let running = await leasedJobCount(db);
  while (running > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    running = await leasedJobCount(db);
  }
  return running;
}
