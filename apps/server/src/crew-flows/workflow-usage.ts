import {
  WORKFLOW_USAGE_CHATS_MAX,
  type WorkflowRunSource,
  type WorkflowUsage,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { RUN_TOKENS, toTotals, type TotalsRow } from '../persistence/spark-usage.ts';

const COUNTED_RUNS = `workflow_runs w
  WHERE w.workspace_id = $1 AND w.workflow_id = $2 AND w.kind IN ('run', 'review')`;

const RUN_SPEND = `LEFT JOIN LATERAL (
  SELECT sum(spent.tokens) AS tokens, sum(spent.cost_usd) AS cost_usd FROM (
    SELECT ${RUN_TOKENS} AS tokens, r.cost_usd FROM runs r WHERE r.id = counted.run_id
    UNION ALL
    SELECT ${RUN_TOKENS}, r.cost_usd FROM runs r WHERE r.parent_run_id = counted.run_id
    UNION ALL
    SELECT ${RUN_TOKENS}, r.cost_usd FROM workflow_run_steps s JOIN runs r ON r.id = s.run_id
    WHERE counted.run_id IS NULL AND s.workflow_run_id = counted.id
  ) spent
) spend ON true`;

type SourceRow = TotalsRow & { source: WorkflowRunSource | null };

export async function workflowUsage(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<WorkflowUsage> {
  const sources = await db.query<SourceRow>(
    `SELECT counted.source, count(*)::int AS count, max(counted.started_at) AS last_at,
       sum(spend.tokens)::float8 AS tokens, sum(spend.cost_usd)::float8 AS cost_usd
     FROM (SELECT w.id, w.source, w.run_id, w.started_at FROM ${COUNTED_RUNS}) counted
     ${RUN_SPEND}
     GROUP BY GROUPING SETS ((counted.source), ())
     ORDER BY count(*) DESC, counted.source`,
    [workspaceId, workflowId],
  );
  const chats = await db.query<{ id: string; title: string; runs: number; last_at: Date }>(
    `SELECT c.id, c.title, count(*)::int AS runs, max(counted.started_at) AS last_at
     FROM (SELECT w.conversation_id, w.started_at FROM ${COUNTED_RUNS}) counted
     JOIN conversations c ON c.id = counted.conversation_id
     WHERE c.kind = 'chat'
     GROUP BY c.id, c.title ORDER BY last_at DESC, c.id LIMIT $3`,
    [workspaceId, workflowId, WORKFLOW_USAGE_CHATS_MAX],
  );
  const bySource = sources.rows.filter((row) => row.source !== null);
  const all = sources.rows.find((row) => row.source === null);
  return {
    total: toTotals(all && all.count > 0 ? all : undefined),
    sources: bySource.map((row) => ({ ...toTotals(row), source: row.source! })),
    chats: chats.rows.map((row) => ({
      conversationId: row.id,
      title: row.title,
      runs: row.runs,
      lastAt: row.last_at.toISOString(),
    })),
  };
}
