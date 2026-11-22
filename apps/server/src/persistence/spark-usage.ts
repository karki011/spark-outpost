import {
  NO_USAGE,
  SPARK_ACTIVITY_MAX,
  namesSpark,
  type RunStatus,
  type SparkActivity,
  type SparkActivityKind,
  type SparkUsage,
  type SparkUsageWorkflow,
  type UsageTotals,
} from '@spark-outpost/contracts';
import { crewSparksDir } from '../crew/folders.ts';
import type { WorkflowStore } from '../crew-flows/workflow-store.ts';
import type { Queryable } from './db.ts';
import { getTeammate, listTeammates } from './teammates.ts';

export interface TotalsRow {
  count: number;
  last_at: Date | null;
  tokens: number | null;
  cost_usd: number | null;
}

export function toTotals(row: TotalsRow | undefined): UsageTotals {
  if (!row) return NO_USAGE;
  return {
    count: row.count,
    lastAt: row.last_at ? row.last_at.toISOString() : null,
    tokens: row.tokens ?? 0,
    costUsd: row.cost_usd,
  };
}

export const RUN_TOKENS = 'COALESCE(r.total_tokens, r.input_tokens + r.output_tokens)';

const SPARK_CHILD_RUNS = `runs r JOIN conversations c ON c.id = r.conversation_id
  WHERE c.workspace_id = $1 AND r.parent_run_id IS NOT NULL
    AND r.route->'spark'->>'id' = $2::text AND NOT (r.route->'spark' ? 'test')`;

const LINKED_CHATS = `conversations c
  WHERE c.workspace_id = $1 AND c.teammate_id = $2::uuid AND c.kind = 'chat'
    AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)`;

const CHAT_TOKENS = `(SELECT sum(${RUN_TOKENS}) FROM runs r WHERE r.conversation_id = c.id)`;
const CHAT_COST = '(SELECT sum(r.cost_usd) FROM runs r WHERE r.conversation_id = c.id)';

async function chatTotals(db: Queryable, workspaceId: string, sparkId: string) {
  const { rows } = await db.query<TotalsRow>(
    `SELECT count(*)::int AS count, max(linked.updated_at) AS last_at,
       sum(linked.tokens)::float8 AS tokens, sum(linked.cost_usd)::float8 AS cost_usd
     FROM (
       SELECT c.updated_at, ${CHAT_TOKENS} AS tokens, ${CHAT_COST} AS cost_usd
       FROM ${LINKED_CHATS}
     ) linked`,
    [workspaceId, sparkId],
  );
  return toTotals(rows[0]);
}

async function childTotals(db: Queryable, workspaceId: string, sparkId: string) {
  const { rows } = await db.query<TotalsRow & { step: boolean }>(
    `SELECT (r.route->'spark' ? 'step') AS step, count(*)::int AS count,
       max(r.created_at) AS last_at, sum(${RUN_TOKENS})::float8 AS tokens,
       sum(r.cost_usd)::float8 AS cost_usd
     FROM ${SPARK_CHILD_RUNS} GROUP BY 1`,
    [workspaceId, sparkId],
  );
  return {
    jobs: toTotals(rows.find((row) => !row.step)),
    steps: toTotals(rows.find((row) => row.step)),
  };
}

interface ActivityRow {
  id: string;
  kind: SparkActivityKind;
  conversation_id: string | null;
  title: string;
  workflow_name: string | null;
  status: RunStatus | null;
  at: Date;
  tokens: number | null;
  cost_usd: number | null;
}

async function recentActivity(
  db: Queryable,
  workspaceId: string,
  sparkId: string,
): Promise<SparkActivity[]> {
  const { rows } = await db.query<ActivityRow>(
    `(SELECT r.id, CASE WHEN r.route->'spark' ? 'step' THEN 'step' ELSE 'job' END AS kind,
        CASE WHEN c.kind = 'chat' THEN c.id END AS conversation_id, c.title,
        (SELECT w.workflow_name FROM workflow_run_steps s
           JOIN workflow_runs w ON w.id = s.workflow_run_id
         WHERE s.run_id = r.id LIMIT 1) AS workflow_name,
        r.status, r.created_at AS at, (${RUN_TOKENS})::float8 AS tokens,
        r.cost_usd::float8 AS cost_usd
      FROM ${SPARK_CHILD_RUNS} ORDER BY r.created_at DESC LIMIT $3)
     UNION ALL
     (SELECT c.id, 'chat' AS kind, c.id AS conversation_id, c.title, NULL AS workflow_name,
        (SELECT r.status FROM runs r WHERE r.conversation_id = c.id AND r.parent_run_id IS NULL
         ORDER BY r.created_at DESC LIMIT 1) AS status,
        c.updated_at AS at, ${CHAT_TOKENS}::float8 AS tokens, ${CHAT_COST}::float8 AS cost_usd
      FROM ${LINKED_CHATS} ORDER BY c.updated_at DESC LIMIT $3)
     ORDER BY at DESC LIMIT $3`,
    [workspaceId, sparkId, SPARK_ACTIVITY_MAX],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    conversationId: row.conversation_id,
    title: row.title,
    workflowName: row.workflow_name,
    status: row.status,
    at: row.at.toISOString(),
    tokens: row.tokens ?? 0,
    costUsd: row.cost_usd,
  }));
}

export async function workflowsUsingSpark(
  store: WorkflowStore,
  sparkId: string,
): Promise<SparkUsageWorkflow[]> {
  const files = await Promise.all((await store.ids()).map((id) => store.read(id)));
  return files.flatMap((file): SparkUsageWorkflow[] => {
    if (!file) return [];
    const { id, name, steps } = file.workflow;
    const used = steps.flatMap((step, index) => (step.sparkId === sparkId ? [index + 1] : []));
    return used.length > 0 ? [{ id, name, steps: used, stepCount: steps.length }] : [];
  });
}

export interface SparkUsageDeps {
  db: Queryable;
  workspaceId: string;
  store: WorkflowStore;
  sparksDir?: string;
}

export async function sparkUsage(
  { db, workspaceId, store, sparksDir = crewSparksDir() }: SparkUsageDeps,
  sparkId: string,
): Promise<SparkUsage> {
  const spark = await getTeammate(db, workspaceId, sparkId, sparksDir);
  const [workflows, others, chats, children, recent] = await Promise.all([
    workflowsUsingSpark(store, sparkId),
    listTeammates(db, workspaceId, sparksDir),
    chatTotals(db, workspaceId, sparkId),
    childTotals(db, workspaceId, sparkId),
    recentActivity(db, workspaceId, sparkId),
  ]);
  return {
    workflows,
    sparks: others
      .filter((other) => other.id !== sparkId && namesSpark(other.instructions, spark.name))
      .map(({ id, name }) => ({ id, name })),
    chats,
    ...children,
    recent,
  };
}
