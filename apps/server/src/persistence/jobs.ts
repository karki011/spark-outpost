import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface Lease {
  jobId: string;
  runId: string;
  token: string;
  attempt: number;
}

export async function claimNextJob(db: Queryable, leaseSeconds: number): Promise<Lease | null> {
  const { rows } = await db.query<{
    id: string;
    run_id: string;
    lease_token: string;
    attempts: number;
  }>(
    `UPDATE jobs SET
       status = 'leased',
       attempts = attempts + 1,
       lease_token = $1,
       lease_expires_at = now() + make_interval(secs => $2),
       updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'queued' AND available_at <= now()
       ORDER BY available_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, run_id, lease_token, attempts`,
    [newId(), leaseSeconds],
  );
  const row = rows[0];
  return row
    ? { jobId: row.id, runId: row.run_id, token: row.lease_token, attempt: row.attempts }
    : null;
}

export async function renewLease(
  db: Queryable,
  lease: Lease,
  leaseSeconds: number,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE jobs SET lease_expires_at = now() + make_interval(secs => $3), updated_at = now()
     WHERE id = $1 AND lease_token = $2 AND status = 'leased' AND lease_expires_at > now()`,
    [lease.jobId, lease.token, leaseSeconds],
  );
  return rowCount === 1;
}

export async function findExpiredLeases(db: Queryable): Promise<Lease[]> {
  const { rows } = await db.query<{
    id: string;
    run_id: string;
    lease_token: string;
    attempts: number;
  }>(
    `SELECT id, run_id, lease_token, attempts FROM jobs
     WHERE status = 'leased' AND lease_expires_at <= now()
     ORDER BY lease_expires_at`,
  );
  return rows.map((row) => ({
    jobId: row.id,
    runId: row.run_id,
    token: row.lease_token,
    attempt: row.attempts,
  }));
}
