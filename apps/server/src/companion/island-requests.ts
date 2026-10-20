import type { IslandRequest, IslandRequestKind } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

export const ISLAND_REQUESTS_MAX = 50;

async function announce(db: Queryable): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'island_request', conversationId: null, runId: null }),
  ]);
}

export async function addIslandRequest(
  db: Queryable,
  workspaceId: string,
  request: { kind: IslandRequestKind; target: string; expiresAt: Date },
): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO island_requests (id, workspace_id, kind, target, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, workspaceId, request.kind, request.target, request.expiresAt],
  );
  await announce(db);
  return id;
}

export async function listIslandRequests(
  db: Queryable,
  workspaceId: string,
): Promise<IslandRequest[]> {
  await db.query('DELETE FROM island_requests WHERE workspace_id = $1 AND expires_at <= now()', [
    workspaceId,
  ]);
  const { rows } = await db.query<IslandRequest>(
    `SELECT id, kind, target FROM island_requests WHERE workspace_id = $1
     ORDER BY created_at LIMIT $2`,
    [workspaceId, ISLAND_REQUESTS_MAX],
  );
  return rows;
}

export async function claimIslandRequest(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<IslandRequest | null> {
  const { rows } = await db.query<IslandRequest>(
    `DELETE FROM island_requests WHERE id = $1 AND workspace_id = $2 AND expires_at > now()
     RETURNING id, kind, target`,
    [id, workspaceId],
  );
  return rows[0] ?? null;
}
