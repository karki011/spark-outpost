import type { Queryable } from './db.ts';

export interface WorktreeRecord {
  runId: string;
  orchestrationRunId: string;
  repoRoot: string;
  path: string;
  branch: string;
  baseCommit: string;
  resultCommit: string | null;
  mergedAt: Date | null;
  removedAt: Date | null;
}

interface WorktreeRow {
  run_id: string;
  orchestration_run_id: string;
  repo_root: string;
  path: string;
  branch: string;
  base_commit: string;
  result_commit: string | null;
  merged_at: Date | null;
  removed_at: Date | null;
}

function toRecord(row: WorktreeRow): WorktreeRecord {
  return {
    runId: row.run_id,
    orchestrationRunId: row.orchestration_run_id,
    repoRoot: row.repo_root,
    path: row.path,
    branch: row.branch,
    baseCommit: row.base_commit,
    resultCommit: row.result_commit,
    mergedAt: row.merged_at,
    removedAt: row.removed_at,
  };
}

export async function insertWorktree(
  db: Queryable,
  record: Pick<
    WorktreeRecord,
    'runId' | 'orchestrationRunId' | 'repoRoot' | 'path' | 'branch' | 'baseCommit'
  >,
): Promise<void> {
  await db.query(
    `INSERT INTO run_worktrees (run_id, orchestration_run_id, repo_root, path, branch, base_commit)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      record.runId,
      record.orchestrationRunId,
      record.repoRoot,
      record.path,
      record.branch,
      record.baseCommit,
    ],
  );
}

export async function getWorktree(db: Queryable, runId: string): Promise<WorktreeRecord | null> {
  const { rows } = await db.query<WorktreeRow>('SELECT * FROM run_worktrees WHERE run_id = $1', [
    runId,
  ]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function saveResult(db: Queryable, runId: string, commit: string): Promise<void> {
  await db.query('UPDATE run_worktrees SET result_commit = $2 WHERE run_id = $1', [runId, commit]);
}

export async function markMerged(db: Queryable, runId: string): Promise<void> {
  await db.query('UPDATE run_worktrees SET merged_at = now() WHERE run_id = $1', [runId]);
}

export async function markRemoved(db: Queryable, runId: string): Promise<void> {
  await db.query('UPDATE run_worktrees SET removed_at = now() WHERE run_id = $1', [runId]);
}

export async function liveWorktrees(
  db: Queryable,
  orchestrationRunId: string,
): Promise<WorktreeRecord[]> {
  const { rows } = await db.query<WorktreeRow>(
    `SELECT * FROM run_worktrees WHERE orchestration_run_id = $1 AND removed_at IS NULL
     ORDER BY created_at`,
    [orchestrationRunId],
  );
  return rows.map(toRecord);
}

export async function orphanedWorktrees(db: Queryable): Promise<WorktreeRecord[]> {
  const { rows } = await db.query<WorktreeRow>(
    `SELECT w.* FROM run_worktrees w JOIN runs o ON o.id = w.orchestration_run_id
     WHERE w.removed_at IS NULL
       AND o.status IN ('succeeded', 'failed', 'cancelled', 'outcome_unknown')
     ORDER BY w.created_at`,
  );
  return rows.map(toRecord);
}

export async function worktreesForRuns(
  db: Queryable,
  runIds: readonly string[],
): Promise<Map<string, WorktreeRecord & { name: string | null }>> {
  if (runIds.length === 0) return new Map();
  const { rows } = await db.query<WorktreeRow & { name: string | null }>(
    `SELECT w.*, r.route->>'name' AS name FROM run_worktrees w JOIN runs r ON r.id = w.run_id
     WHERE w.run_id = ANY($1::uuid[])`,
    [runIds],
  );
  return new Map(rows.map((row) => [row.run_id, { ...toRecord(row), name: row.name }]));
}
