import {
  mergeCostSource,
  recordedItems,
  taskRunSchema,
  taskSummary,
  type CostSource,
  type RunMode,
  type RunStatus,
  type TaskDetail,
  type TaskOverview,
  type TaskRun,
  type TaskStatus,
  type ApprovalStatus,
  type TaskItemState,
  type TaskListEvent,
  type SparkAction,
  type SparkResult,
  sparkActionLabels,
  todoItems,
} from '@spark-outpost/contracts';
import { latestPlans, planVersions } from './artifacts.ts';
import { latestApprovedPlan } from './plan-documents.ts';
import type { Queryable } from './db.ts';
import { taskLinks } from './tasks.ts';

interface TaskRow {
  id: string;
  conversation_id: string;
  title: string;
  status: TaskStatus;
  created_at: Date;
  closed_at: Date | null;
}

interface TaskRunRow {
  id: string;
  task_id: string;
  provider: string;
  model: string | null;
  effort: string | null;
  status: RunStatus;
  plan_version: number | null;
  tokens: number | null;
  cost_usd: string | null;
  cost_source: CostSource | null;
  mode: RunMode | null;
  duration_ms: number | null;
  created_at: Date;
  name: string | null;
}

type TaskRunView = TaskRun & Pick<TaskRunRow, 'name'>;

const runsQuery = `
  SELECT r.id, r.task_id, r.provider, COALESCE(r.used_model, r.model) AS model,
    COALESCE(r.used_effort, r.effort) AS effort, r.status, r.plan_version,
    COALESCE(r.total_tokens, r.input_tokens + r.output_tokens) AS tokens,
    r.cost_usd, r.cost_source, r.mode, r.duration_ms, r.created_at, r.route->>'name' AS name
  FROM runs r
  WHERE r.task_id = ANY($1::uuid[])
    AND NOT (r.role IS NULL AND EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id))
  ORDER BY r.created_at, r.id`;

function toTaskRun(row: TaskRunRow): TaskRunView {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    status: row.status,
    planVersion: row.plan_version,
    tokens: row.tokens,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    costSource: row.cost_usd === null ? null : (row.cost_source ?? 'reported'),
    mode: row.mode,
    durationMs: row.duration_ms,
    createdAt: row.created_at.toISOString(),
    name: row.name,
  };
}

interface ApprovalEventRow {
  id: string;
  task_id: string;
  kind: string;
  title: string;
  status: ApprovalStatus;
  option_name: string | null;
  full_paths: string[] | null;
  spark_action: SparkAction | null;
  spark_result: SparkResult | null;
}

const APPROVAL_STATES: Record<ApprovalStatus, TaskItemState> = {
  pending: 'waiting',
  allowed: 'done',
  denied: 'failed',
  cancelled: 'failed',
  expired: 'failed',
};

const DECISION_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Waiting for you',
  allowed: 'Allowed',
  denied: 'Denied',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

function approvalDecision(row: ApprovalEventRow): string {
  const decision = DECISION_LABELS[row.status];
  return row.option_name ? `${decision}: ${row.option_name}` : decision;
}

type ApprovalProgress = Pick<TaskListEvent, 'state' | 'label' | 'detail' | 'action' | 'url'>;

const ACTION_STATES: Record<SparkResult['state'], 'active' | 'done' | 'failed'> = {
  waiting: 'active',
  running: 'active',
  done: 'done',
  failed: 'failed',
  unknown: 'failed',
};

function approvalProgress(row: ApprovalEventRow): ApprovalProgress {
  const { spark_action: action, spark_result: result } = row;
  if (row.status === 'pending') return { state: 'waiting', label: `Waiting for you: ${row.title}` };
  if (row.status !== 'allowed' || !action || !result) {
    return { state: APPROVAL_STATES[row.status], label: row.title, detail: approvalDecision(row) };
  }
  const state = ACTION_STATES[result.state];
  const doing = sparkActionLabels[action.action].doing;
  const label = { active: doing, done: result.message ?? row.title, failed: row.title }[state];
  const detail = state === 'failed' ? (result.message ?? undefined) : row.title;
  return {
    state,
    label,
    action: true,
    ...(detail ? { detail } : {}),
    ...(result.url ? { url: result.url } : {}),
  };
}

function grouped<T>(entries: readonly (readonly [string, T])[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const [key, value] of entries) {
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}

async function approvalEvents(
  db: Queryable,
  taskIds: readonly string[],
): Promise<Map<string, TaskListEvent[]>> {
  const { rows } = await db.query<ApprovalEventRow>(
    `SELECT a.id, r.task_id, a.kind, a.title, a.status,
       a.payload->'fullPaths' AS full_paths, a.payload->'sparkAction' AS spark_action,
       a.payload->'sparkResult' AS spark_result,
       (SELECT o->>'name' FROM jsonb_array_elements(a.options) o
        WHERE o->>'optionId' = a.decision_option_id LIMIT 1) AS option_name
     FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.task_id = ANY($1::uuid[])
       AND (a.status = 'pending' OR a.decided_by IN ('user', 'auto')
         OR a.payload ? 'sparkResult')
     ORDER BY a.created_at, a.id`,
    [taskIds],
  );
  return grouped(
    rows.map((row) => [
      row.task_id,
      {
        id: row.id,
        kind: 'waiting',
        ...(row.full_paths?.length ? { hint: row.full_paths.join('\n') } : {}),
        ...(row.kind === 'execute' ? { command: true } : {}),
        ...approvalProgress(row),
      },
    ]),
  );
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}

interface TaskFacts {
  runs: Map<string, TaskRunView[]>;
  plans: Awaited<ReturnType<typeof latestPlans>>;
  agreedPlanVersion: number | null;
  approvals: Map<string, TaskListEvent[]>;
}

async function loadTaskFacts(
  db: Queryable,
  conversationId: string,
  taskIds: readonly string[],
): Promise<TaskFacts> {
  const [runs, plans, agreed, approvals] = await Promise.all([
    loadRuns(db, taskIds),
    latestPlans(db, taskIds),
    latestApprovedPlan(db, conversationId),
    approvalEvents(db, taskIds),
  ]);
  return { runs, plans, agreedPlanVersion: agreed?.version ?? null, approvals };
}

function overview(row: TaskRow, facts: TaskFacts): TaskOverview {
  const runs = facts.runs.get(row.id) ?? [];
  const plan = facts.plans.get(row.id) ?? null;
  const todo = todoItems(plan, runs);
  const recorded = recordedItems(facts.approvals.get(row.id) ?? []);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
    runIds: runs.map((run) => run.id),
    planVersion: plan?.version ?? null,
    agreedPlanVersion: facts.agreedPlanVersion,
    todo,
    recorded,
    summary: taskSummary(todo, recorded, runs),
    costUsd: sumOrNull(runs.map((run) => run.costUsd)),
    costSource: runs.reduce<TaskOverview['costSource']>(
      (source, run) => mergeCostSource(source ?? null, run.costSource ?? null),
      null,
    ),
    tokens: sumOrNull(runs.map((run) => run.tokens)),
  };
}

async function loadRuns(db: Queryable, taskIds: readonly string[]) {
  const { rows } = await db.query<TaskRunRow>(runsQuery, [taskIds]);
  const byTask = new Map<string, TaskRunView[]>();
  for (const row of rows) {
    const runs = byTask.get(row.task_id) ?? [];
    runs.push(toTaskRun(row));
    byTask.set(row.task_id, runs);
  }
  return byTask;
}

export async function taskOverviews(
  db: Queryable,
  conversationId: string,
): Promise<TaskOverview[]> {
  const { rows } = await db.query<TaskRow>(
    'SELECT * FROM tasks WHERE conversation_id = $1 ORDER BY created_at, id',
    [conversationId],
  );
  if (rows.length === 0) return [];
  const facts = await loadTaskFacts(
    db,
    conversationId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => overview(row, facts));
}

export async function getTaskDetail(db: Queryable, taskId: string): Promise<TaskDetail | null> {
  const { rows } = await db.query<TaskRow>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const row = rows[0];
  if (!row) return null;
  const [facts, versions, links] = await Promise.all([
    loadTaskFacts(db, row.conversation_id, [taskId]),
    planVersions(db, taskId),
    taskLinks(db, [taskId]),
  ]);
  return {
    ...overview(row, facts),
    runs: (facts.runs.get(taskId) ?? []).map((run) => taskRunSchema.parse(run)),
    planVersions: versions,
    links: links.get(taskId) ?? [],
  };
}
