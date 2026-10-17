import type { Queryable } from './db.ts';

export interface FileRevert {
  runId: string;
  path: string;
  beforeBlob: string | null;
  afterBlob: string | null;
  revertedAt: Date;
}

export type NewFileRevert = Omit<FileRevert, 'runId' | 'revertedAt'>;

export async function listFileReverts(
  db: Queryable,
  runIds: readonly string[],
): Promise<FileRevert[]> {
  if (runIds.length === 0) return [];
  const { rows } = await db.query<{
    run_id: string;
    path: string;
    before_blob: string | null;
    after_blob: string | null;
    reverted_at: Date;
  }>(
    `SELECT run_id, path, before_blob, after_blob, reverted_at FROM run_file_reverts
     WHERE run_id = ANY($1::uuid[]) ORDER BY reverted_at, path`,
    [runIds],
  );
  return rows.map((row) => ({
    runId: row.run_id,
    path: row.path,
    beforeBlob: row.before_blob,
    afterBlob: row.after_blob,
    revertedAt: row.reverted_at,
  }));
}

export async function saveFileReverts(
  db: Queryable,
  runId: string,
  reverts: readonly NewFileRevert[],
): Promise<Date> {
  let revertedAt = new Date();
  for (const revert of reverts) {
    const { rows } = await db.query<{ reverted_at: Date }>(
      `INSERT INTO run_file_reverts (run_id, path, before_blob, after_blob)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_id, path) DO UPDATE SET before_blob = EXCLUDED.before_blob,
         after_blob = EXCLUDED.after_blob, reverted_at = now(), noted_at = NULL
       RETURNING reverted_at`,
      [runId, revert.path, revert.beforeBlob, revert.afterBlob],
    );
    revertedAt = rows[0]?.reverted_at ?? revertedAt;
  }
  return revertedAt;
}

export interface UnnotedRevert {
  runId: string;
  runNumber: number;
  path: string;
  revertedAt: Date;
}

export async function unnotedReverts(
  db: Queryable,
  conversationId: string,
): Promise<UnnotedRevert[]> {
  const { rows } = await db.query<{
    run_id: string;
    run_number: number;
    path: string;
    reverted_at: Date;
  }>(
    `WITH turns AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)::int AS run_number
       FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
     )
     SELECT f.run_id, t.run_number, f.path, f.reverted_at FROM run_file_reverts f JOIN turns t ON t.id = f.run_id
     WHERE f.noted_at IS NULL ORDER BY t.run_number, f.path`,
    [conversationId],
  );
  return rows.map((row) => ({
    runId: row.run_id,
    runNumber: row.run_number,
    path: row.path,
    revertedAt: row.reverted_at,
  }));
}

export async function markRevertsNoted(
  db: Queryable,
  reverts: readonly UnnotedRevert[],
): Promise<void> {
  for (const revert of reverts) {
    await db.query(
      `UPDATE run_file_reverts SET noted_at = now()
       WHERE run_id = $1 AND path = $2 AND noted_at IS NULL
         AND date_trunc('milliseconds', reverted_at) = $3`,
      [revert.runId, revert.path, revert.revertedAt],
    );
  }
}

export async function chatHasWorkingRun(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ working: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM runs other JOIN runs r ON r.conversation_id = other.conversation_id
       WHERE r.id = $1 AND other.status IN ('queued', 'running', 'awaiting_approval')
     ) AS working`,
    [runId],
  );
  return rows[0]?.working ?? false;
}

export async function lockRun(db: Queryable, runId: string): Promise<void> {
  await db.query('SELECT id FROM runs WHERE id = $1 FOR UPDATE', [runId]);
}
