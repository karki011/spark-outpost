import type { Queryable } from './db.ts';

export type SnapshotKind = 'git' | 'files';

export interface RunSnapshot {
  kind: SnapshotKind;
  ref: string | null;
  root: string;
}

export interface RunSnapshotState {
  snapshot: RunSnapshot | null;
  status: string;
  revertedAt: Date | null;
  endRef: string | null;
}

export interface FileBackup {
  path: string;
  existed: boolean;
  content: Buffer | null;
}

export async function saveSnapshot(
  db: Queryable,
  runId: string,
  snapshot: RunSnapshot,
): Promise<void> {
  await db.query(
    'UPDATE runs SET snapshot_kind = $2, snapshot_ref = $3, snapshot_root = $4 WHERE id = $1',
    [runId, snapshot.kind, snapshot.ref, snapshot.root],
  );
}

export async function getSnapshot(
  db: Queryable,
  workspaceId: string,
  runId: string,
): Promise<RunSnapshotState | null> {
  const { rows } = await db.query<{
    snapshot_kind: SnapshotKind | null;
    snapshot_ref: string | null;
    snapshot_root: string | null;
    status: string;
    reverted_at: Date | null;
    snapshot_end_ref: string | null;
  }>(
    `SELECT r.snapshot_kind, r.snapshot_ref, r.snapshot_root, r.status, r.reverted_at,
            r.snapshot_end_ref
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE r.id = $1 AND c.workspace_id = $2`,
    [runId, workspaceId],
  );
  const row = rows[0];
  if (!row) return null;
  const snapshot =
    row.snapshot_kind && row.snapshot_root
      ? { kind: row.snapshot_kind, ref: row.snapshot_ref, root: row.snapshot_root }
      : null;
  return {
    snapshot,
    status: row.status,
    revertedAt: row.reverted_at,
    endRef: row.snapshot_end_ref,
  };
}

export async function saveBackup(db: Queryable, runId: string, backup: FileBackup): Promise<void> {
  await db.query(
    `INSERT INTO run_file_backups (run_id, path, existed, content) VALUES ($1, $2, $3, $4)
     ON CONFLICT (run_id, path) DO NOTHING`,
    [runId, backup.path, backup.existed, backup.content],
  );
}

export async function listBackups(db: Queryable, runId: string): Promise<FileBackup[]> {
  const { rows } = await db.query<FileBackup>(
    'SELECT path, existed, content FROM run_file_backups WHERE run_id = $1 ORDER BY path',
    [runId],
  );
  return rows;
}

export async function markReverted(db: Queryable, runId: string): Promise<Date | null> {
  const { rows } = await db.query<{ reverted_at: Date }>(
    `UPDATE runs SET reverted_at = now() WHERE id = $1 AND reverted_at IS NULL
     RETURNING reverted_at`,
    [runId],
  );
  return rows[0]?.reverted_at ?? null;
}

export async function clearReverted(db: Queryable, runId: string): Promise<void> {
  await db.query('UPDATE runs SET reverted_at = NULL WHERE id = $1', [runId]);
}

export async function saveSnapshotEnd(db: Queryable, runId: string, ref: string): Promise<void> {
  await db.query('UPDATE runs SET snapshot_end_ref = $2 WHERE id = $1', [runId, ref]);
}
