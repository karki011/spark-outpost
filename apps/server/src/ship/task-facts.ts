import {
  checkBodySchema,
  checkLine,
  reviewBodySchema,
  type ReviewBody,
} from '@spark-outpost/contracts';
import path from 'node:path';
import type { Queryable } from '../persistence/db.ts';
import { WORKTREES_DIR } from '../projects/worktrees.ts';

export interface ShipTaskFacts {
  running: boolean;
  roots: string[];
  unmergedCopy: boolean;
  summary: string | null;
  checks: string[];
  review: ReviewBody | null;
  auditRunId: string | null;
}

interface RootRow {
  snapshot_root: string;
  repo_root: string | null;
  merged_at: Date | null;
  removed_at: Date | null;
  chat_path: string | null;
}

const COPY_MARKER = `${path.sep}${WORKTREES_DIR}${path.sep}`;

export function projectRoot(root: string): string {
  const at = root.indexOf(COPY_MARKER);
  return at >= 0 ? root.slice(0, at) : root;
}

async function roots(db: Queryable, taskId: string) {
  const { rows } = await db.query<RootRow>(
    `SELECT r.snapshot_root, w.repo_root, w.merged_at, w.removed_at, cw.path AS chat_path
     FROM runs r LEFT JOIN run_worktrees w ON w.run_id = r.id
     LEFT JOIN chat_worktrees cw ON cw.path = COALESCE(w.repo_root, r.snapshot_root)
       AND cw.removed_at IS NULL AND NOT cw.in_place
     WHERE r.task_id = $1 AND r.snapshot_root IS NOT NULL AND r.reverted_at IS NULL`,
    [taskId],
  );
  const rootOf = (row: RootRow) => row.chat_path ?? projectRoot(row.repo_root ?? row.snapshot_root);
  return {
    roots: [...new Set(rows.map(rootOf))],
    unmergedCopy: rows.some(
      (row) => row.repo_root !== null && row.merged_at === null && row.removed_at === null,
    ),
  };
}

async function artifactBodies(db: Queryable, taskId: string, kind: string): Promise<unknown[]> {
  const { rows } = await db.query<{ body: unknown }>(
    'SELECT body FROM run_artifacts WHERE task_id = $1 AND kind = $2 ORDER BY version',
    [taskId, kind],
  );
  return rows.map((row) => row.body);
}

async function checkLines(db: Queryable, taskId: string): Promise<string[]> {
  const latest = new Map<string, string>();
  for (const body of await artifactBodies(db, taskId, 'check')) {
    const parsed = checkBodySchema.safeParse(body);
    if (parsed.success) latest.set(parsed.data.name, checkLine(parsed.data));
  }
  return [...latest.values()];
}

async function lastReview(db: Queryable, taskId: string): Promise<ReviewBody | null> {
  const bodies = await artifactBodies(db, taskId, 'review');
  const parsed = reviewBodySchema.safeParse(bodies.at(-1));
  return parsed.success ? parsed.data : null;
}

export async function shipTaskFacts(db: Queryable, taskId: string): Promise<ShipTaskFacts> {
  const [active, summary, audit] = await Promise.all([
    db.query<{ running: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM runs WHERE task_id = $1
         AND status IN ('queued', 'running', 'awaiting_approval')) AS running`,
      [taskId],
    ),
    db.query<{ content: string }>(
      `SELECT m.content FROM messages m JOIN runs r ON r.id = m.run_id
       WHERE r.task_id = $1 AND m.role = 'assistant' AND m.content <> ''
       ORDER BY m.created_at DESC LIMIT 1`,
      [taskId],
    ),
    db.query<{ id: string }>(
      `SELECT id FROM runs WHERE task_id = $1
       ORDER BY (parent_run_id IS NULL) DESC, created_at DESC LIMIT 1`,
      [taskId],
    ),
  ]);
  return {
    running: active.rows[0]?.running ?? false,
    ...(await roots(db, taskId)),
    summary: summary.rows[0]?.content ?? null,
    checks: await checkLines(db, taskId),
    review: await lastReview(db, taskId),
    auditRunId: audit.rows[0]?.id ?? null,
  };
}
