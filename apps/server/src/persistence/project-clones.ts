import type { Queryable } from './db.ts';

export interface DirectoryIdentity {
  dev: string;
  ino: string;
}

export interface CloneMarker {
  id: string;
  source: string;
  destination: string;
  identity: DirectoryIdentity;
  pid: number | null;
  startedAt: Date;
}

interface Row {
  id: string;
  source: string;
  destination: string;
  dir_dev: string;
  dir_ino: string;
  pid: number | null;
  started_at: Date;
}

export async function saveCloneMarker(
  db: Queryable,
  workspaceId: string,
  marker: Omit<CloneMarker, 'pid' | 'startedAt'>,
): Promise<void> {
  await db.query(
    `INSERT INTO project_clones (id, workspace_id, source, destination, dir_dev, dir_ino)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      marker.id,
      workspaceId,
      marker.source,
      marker.destination,
      marker.identity.dev,
      marker.identity.ino,
    ],
  );
}

export async function updateCloneMarker(
  db: Queryable,
  id: string,
  change: { identity: DirectoryIdentity; pid: number | null },
): Promise<void> {
  await db.query('UPDATE project_clones SET dir_dev = $2, dir_ino = $3, pid = $4 WHERE id = $1', [
    id,
    change.identity.dev,
    change.identity.ino,
    change.pid,
  ]);
}

export async function deleteCloneMarker(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM project_clones WHERE id = $1', [id]);
}

export async function cloneMarkers(db: Queryable, workspaceId: string): Promise<CloneMarker[]> {
  const { rows } = await db.query<Row>(
    `SELECT id, source, destination, dir_dev, dir_ino, pid, started_at
     FROM project_clones WHERE workspace_id = $1 ORDER BY started_at`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    destination: row.destination,
    identity: { dev: row.dir_dev, ino: row.dir_ino },
    pid: row.pid,
    startedAt: row.started_at,
  }));
}
