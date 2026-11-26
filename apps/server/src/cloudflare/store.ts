import type { Queryable } from '../persistence/db.ts';

export interface CloudflareRow {
  origin: string;
  shareArtifacts: boolean;
  maxDays: number;
  checkedAt: Date | null;
  problem: string | null;
}

interface StoredRow {
  origin: string;
  share_artifacts: boolean;
  max_days: number;
  checked_at: Date | null;
  problem: string | null;
}

const COLUMNS = 'origin, share_artifacts, max_days, checked_at, problem';

function toRow(row: StoredRow | undefined): CloudflareRow | null {
  if (!row) return null;
  return {
    origin: row.origin,
    shareArtifacts: row.share_artifacts,
    maxDays: row.max_days,
    checkedAt: row.checked_at,
    problem: row.problem,
  };
}

export async function cloudflareRow(
  db: Queryable,
  workspaceId: string,
): Promise<CloudflareRow | null> {
  const { rows } = await db.query<StoredRow>(
    `SELECT ${COLUMNS} FROM cloudflare_connections WHERE workspace_id = $1`,
    [workspaceId],
  );
  return toRow(rows[0]);
}

export async function saveCloudflare(
  db: Queryable,
  workspaceId: string,
  origin: string,
  maxDays: number,
): Promise<void> {
  await db.query(
    `INSERT INTO cloudflare_connections (workspace_id, origin, max_days, checked_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (workspace_id) DO UPDATE
       SET origin = EXCLUDED.origin, max_days = EXCLUDED.max_days,
           checked_at = now(), problem = NULL`,
    [workspaceId, origin, maxDays],
  );
}

export async function setCloudflareSharing(
  db: Queryable,
  workspaceId: string,
  shareArtifacts: boolean,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'UPDATE cloudflare_connections SET share_artifacts = $2 WHERE workspace_id = $1',
    [workspaceId, shareArtifacts],
  );
  return rowCount === 1;
}

export async function recordCloudflareCheck(
  db: Queryable,
  workspaceId: string,
  origin: string,
  problem: string | null,
  maxDays: number | null,
): Promise<void> {
  await db.query(
    `UPDATE cloudflare_connections
     SET checked_at = now(), problem = $3, max_days = COALESCE($4, max_days)
     WHERE workspace_id = $1 AND origin = $2`,
    [workspaceId, origin, problem, maxDays],
  );
}

export async function deleteCloudflare(db: Queryable, workspaceId: string): Promise<void> {
  await db.query('DELETE FROM cloudflare_connections WHERE workspace_id = $1', [workspaceId]);
}

export async function liveSharesOn(db: Queryable, origin: string): Promise<number> {
  const prefix = `${origin}/a/`;
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM artifact_page_shares
     WHERE state = 'live' AND expires_at > now() AND left(url, $2) = $1`,
    [prefix, prefix.length],
  );
  return rows[0]?.count ?? 0;
}
