import type { Queryable } from '../persistence/db.ts';

export interface ReachRow {
  hostname: string;
  accountId: string;
  zoneId: string;
  tunnelId: string;
}

interface StoredRow {
  hostname: string;
  account_id: string;
  zone_id: string;
  tunnel_id: string;
}

export async function reachRow(db: Queryable, workspaceId: string): Promise<ReachRow | null> {
  const { rows } = await db.query<StoredRow>(
    'SELECT hostname, account_id, zone_id, tunnel_id FROM cloudflare_reach WHERE workspace_id = $1',
    [workspaceId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    hostname: row.hostname,
    accountId: row.account_id,
    zoneId: row.zone_id,
    tunnelId: row.tunnel_id,
  };
}

export async function saveReach(db: Queryable, workspaceId: string, row: ReachRow): Promise<void> {
  await db.query(
    `INSERT INTO cloudflare_reach (workspace_id, hostname, account_id, zone_id, tunnel_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id) DO UPDATE
       SET hostname = EXCLUDED.hostname, account_id = EXCLUDED.account_id,
           zone_id = EXCLUDED.zone_id, tunnel_id = EXCLUDED.tunnel_id, created_at = now()`,
    [workspaceId, row.hostname, row.accountId, row.zoneId, row.tunnelId],
  );
}

export async function deleteReach(db: Queryable, workspaceId: string): Promise<void> {
  await db.query('DELETE FROM cloudflare_reach WHERE workspace_id = $1', [workspaceId]);
}
