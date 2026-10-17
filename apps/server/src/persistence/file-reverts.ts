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
         after_blob = EXCLUDED.after_blob, reverted_at = now()
       RETURNING reverted_at`,
      [runId, revert.path, revert.beforeBlob, revert.afterBlob],
    );
    revertedAt = rows[0]?.reverted_at ?? revertedAt;
  }
  return revertedAt;
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
