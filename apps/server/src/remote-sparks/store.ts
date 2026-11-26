import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

export interface RemoteSparkRow {
  id: string;
  name: string;
  hostname: string;
  created_at: Date;
  last_opened_at: Date | null;
}

const COLUMNS = 'id, name, hostname, created_at, last_opened_at';

export class RemoteSparkTakenError extends Error {
  constructor() {
    super('That Mac is already in your list.');
  }
}

export async function listRemoteSparks(
  db: Queryable,
  workspaceId: string,
): Promise<RemoteSparkRow[]> {
  const { rows } = await db.query<RemoteSparkRow>(
    `SELECT ${COLUMNS} FROM remote_sparks WHERE workspace_id = $1 ORDER BY created_at, id`,
    [workspaceId],
  );
  return rows;
}

export async function remoteSpark(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<RemoteSparkRow | null> {
  const { rows } = await db.query<RemoteSparkRow>(
    `SELECT ${COLUMNS} FROM remote_sparks WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id],
  );
  return rows[0] ?? null;
}

export async function addRemoteSpark(
  db: Queryable,
  workspaceId: string,
  spark: { name: string; hostname: string },
): Promise<RemoteSparkRow> {
  const { rows } = await db.query<RemoteSparkRow>(
    `INSERT INTO remote_sparks (id, workspace_id, name, hostname) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, hostname) DO NOTHING
     RETURNING ${COLUMNS}`,
    [newId(), workspaceId, spark.name, spark.hostname],
  );
  if (!rows[0]) throw new RemoteSparkTakenError();
  return rows[0];
}

export async function renameRemoteSpark(
  db: Queryable,
  workspaceId: string,
  id: string,
  name: string,
): Promise<RemoteSparkRow | null> {
  const { rows } = await db.query<RemoteSparkRow>(
    `UPDATE remote_sparks SET name = $3 WHERE workspace_id = $1 AND id = $2
     RETURNING ${COLUMNS}`,
    [workspaceId, id, name],
  );
  return rows[0] ?? null;
}

export async function deleteRemoteSpark(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM remote_sparks WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id],
  );
  return (rowCount ?? 0) > 0;
}

export async function markRemoteSparkOpened(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<RemoteSparkRow | null> {
  const { rows } = await db.query<RemoteSparkRow>(
    `UPDATE remote_sparks SET last_opened_at = now() WHERE workspace_id = $1 AND id = $2
     RETURNING ${COLUMNS}`,
    [workspaceId, id],
  );
  return rows[0] ?? null;
}

export async function remoteSparkIds(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM remote_sparks ORDER BY id');
  return rows.map((row) => row.id);
}
