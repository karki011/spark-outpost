import type { GithubInboxItem } from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';
import { newId } from '../../persistence/ids.ts';
import { pullKeyOf } from './decide.ts';
import { settleReviewOfWorkflowRun } from './settle.ts';

export const LINK_WINDOW_MS = 15 * 60_000;

interface UnlinkedRun {
  id: string;
  pull_id: string;
  workflow_id: string;
  workflow_name: string;
  one_spark: boolean;
  spark_id: string | null;
  conversation_id: string | null;
  started_at: Date;
}

export async function unlinkedPullRuns(
  db: Queryable,
  workspaceId: string,
  now: Date,
): Promise<UnlinkedRun[]> {
  const { rows } = await db.query<UnlinkedRun>(
    `SELECT w.id, w.pull_id, w.workflow_id, w.workflow_name, w.one_spark,
            w.definition->'steps'->0->>'sparkId' AS spark_id, w.conversation_id, w.started_at
     FROM workflow_runs w
     WHERE w.workspace_id = $1 AND w.kind = 'run' AND w.pull_id IS NOT NULL
       AND (w.status = 'running' OR w.started_at > $2)
       AND NOT EXISTS (SELECT 1 FROM github_reviews g WHERE g.workflow_run_id = w.id)
     ORDER BY w.started_at`,
    [workspaceId, new Date(now.getTime() - LINK_WINDOW_MS)],
  );
  return rows;
}

type Head = Pick<GithubInboxItem, 'id' | 'headSha'>;

export async function linkPullRuns(
  db: Queryable,
  workspaceId: string,
  runs: readonly UnlinkedRun[],
  items: readonly Head[],
): Promise<number> {
  const byKey = new Map(items.map((item) => [pullKeyOf(item.id), item]));
  let linked = 0;
  for (const run of runs) {
    const item = byKey.get(pullKeyOf(run.pull_id));
    if (!item) continue;
    const spark = run.one_spark && run.spark_id !== null;
    const inserted = await db.query(
      `INSERT INTO github_reviews (id, workspace_id, pull_id, pull_key, head_sha, reviewer_kind,
         reviewer_id, reviewer_name, source, state, due_at, requested_at, claimed_at, started_at,
         workflow_run_id, conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'elsewhere', 'running', $9, $9, $9, $9, $10, $11)
       ON CONFLICT DO NOTHING`,
      [
        newId(),
        workspaceId,
        item.id,
        pullKeyOf(item.id),
        item.headSha,
        spark ? 'spark' : 'workflow',
        spark ? run.spark_id : run.workflow_id,
        run.workflow_name,
        run.started_at,
        run.id,
        run.conversation_id,
      ],
    );
    if (inserted.rowCount !== 1) continue;
    linked += 1;
    await settleReviewOfWorkflowRun(db, run.id);
  }
  return linked;
}
