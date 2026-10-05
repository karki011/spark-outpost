import {
  checkBodySchema,
  shortcutsBodySchema,
  shortcutsLine,
  shortcutText,
  checkCause,
  checkDetails,
  checkLine,
  mergeCostSource,
  taskList,
  taskRunSchema,
  taskSummary,
  type CostSource,
  type RunMode,
  type RunStatus,
  type TaskDetail,
  type TaskLink,
  type TaskListRun,
  type TaskOverview,
  type TaskRun,
  type TaskStatus,
  type ApprovalStatus,
  type TaskItemState,
  type TaskListEvent,
  type AgentRole,
  type SparkAction,
  type SparkResult,
  sparkActionLabels,
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
  request: string;
  label: string | null;
  step: string | null;
  role: AgentRole | null;
  name: string | null;
}

type TaskRunView = TaskRun & Pick<TaskRunRow, 'request' | 'label' | 'step' | 'role' | 'name'>;

const runsQuery = `
  SELECT r.id, r.task_id, r.provider, COALESCE(r.used_model, r.model) AS model,
    COALESCE(r.used_effort, r.effort) AS effort, r.status, r.plan_version,
    COALESCE(r.total_tokens, r.input_tokens + r.output_tokens) AS tokens,
    r.cost_usd, r.cost_source, r.mode, r.duration_ms, r.created_at, m.content AS request,
    CASE WHEN r.parent_run_id IS NOT NULL THEN r.agent_label END AS label,
    CASE WHEN r.parent_run_id IS NOT NULL THEN r.route->>'planStep' END AS step,
    r.role, r.route->>'name' AS name
  FROM runs r JOIN messages m ON m.id = r.user_message_id
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
    request: row.request,
    label: row.label,
    step: row.step,
    role: row.role,
    name: row.name,
  };
}

interface ApprovalEventRow {
  id: string;
  task_id: string;
  run_id: string;
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
    `SELECT a.id, r.task_id, a.run_id, a.kind, a.title, a.status,
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
        runId: row.run_id,
        ...(row.full_paths?.length ? { hint: row.full_paths.join('\n') } : {}),
        ...(row.kind === 'execute' ? { command: true } : {}),
        ...approvalProgress(row),
      },
    ]),
  );
}

const CHECK_OUTPUT_SHOWN = 1_500;

function checkOutput(tails: readonly string[]): string | undefined {
  const text = tails
    .map((tail) => tail.trim())
    .filter(Boolean)
    .join('\n\n');
  if (!text) return undefined;
  return text.length > CHECK_OUTPUT_SHOWN ? `…${text.slice(-CHECK_OUTPUT_SHOWN)}` : text;
}

interface ArtifactBody {
  version: number;
  body: unknown;
}

type EventArtifactKind = 'check' | 'shortcuts';

const EVENT_ARTIFACT_KINDS: readonly EventArtifactKind[] = ['check', 'shortcuts'];

async function taskArtifactBodies(
  db: Queryable,
  taskIds: readonly string[],
): Promise<Record<EventArtifactKind, Map<string, ArtifactBody[]>>> {
  const { rows } = await db.query<ArtifactBody & { task_id: string; kind: EventArtifactKind }>(
    `SELECT task_id, kind, version, body FROM run_artifacts
     WHERE task_id = ANY($1::uuid[]) AND kind = ANY($2::text[])
     ORDER BY version`,
    [taskIds, EVENT_ARTIFACT_KINDS],
  );
  const ofKind = (kind: EventArtifactKind) =>
    grouped(
      rows
        .filter((row) => row.kind === kind)
        .map((row) => [row.task_id, { version: row.version, body: row.body }]),
    );
  return { check: ofKind('check'), shortcuts: ofKind('shortcuts') };
}

function checkEvents(rows: readonly ArtifactBody[]): TaskListEvent[] {
  return rows.flatMap((row) => {
    const parsed = checkBodySchema.safeParse(row.body);
    if (!parsed.success) return [];
    const body = parsed.data;
    const unfinished = body.results.filter((result) => checkCause(result) !== null);
    const tails = checkOutput(unfinished.map((result) => result.outputTail));
    const output = [checkDetails(body).join('\n'), ...(tails ? [tails] : [])].join('\n\n');
    const notes = body.results.flatMap((result) => (result.note ? [result.note] : []));
    return [
      {
        id: String(row.version),
        kind: 'check' as const,
        runId: body.runId,
        label: checkLine(body),
        state: body.status === 'failed' ? ('failed' as const) : ('done' as const),
        detail: `round ${body.round}${notes.length > 0 ? ` · ${notes.join(' ')}` : ''}`,
        output,
      },
    ];
  });
}

function shortcutEvents(rows: readonly ArtifactBody[]): TaskListEvent[] {
  return rows.flatMap((row) => {
    const parsed = shortcutsBodySchema.safeParse(row.body);
    if (!parsed.success) return [];
    const body = parsed.data;
    return [
      {
        id: String(row.version),
        kind: 'shortcut' as const,
        runId: body.runId,
        label: shortcutsLine(body),
        state: 'done' as const,
        detail: `build style ${body.style}`,
        output: body.entries.map(shortcutText).join('\n'),
      },
    ];
  });
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}

interface TaskFacts {
  runs: Map<string, TaskRunView[]>;
  links: Map<string, TaskLink[]>;
  plans: Awaited<ReturnType<typeof latestPlans>>;
  agreedPlanVersion: number | null;
  approvals: Map<string, TaskListEvent[]>;
  artifacts: Awaited<ReturnType<typeof taskArtifactBodies>>;
}

async function loadTaskFacts(
  db: Queryable,
  conversationId: string,
  taskIds: readonly string[],
): Promise<TaskFacts> {
  const [runs, links, plans, agreed, approvals, artifacts] = await Promise.all([
    loadRuns(db, taskIds),
    taskLinks(db, taskIds),
    latestPlans(db, taskIds),
    latestApprovedPlan(db, conversationId),
    approvalEvents(db, taskIds),
    taskArtifactBodies(db, taskIds),
  ]);
  return { runs, links, plans, agreedPlanVersion: agreed?.version ?? null, approvals, artifacts };
}

function overview(row: TaskRow, facts: TaskFacts): TaskOverview {
  const runs = facts.runs.get(row.id) ?? [];
  const links = facts.links.get(row.id) ?? [];
  const plan = facts.plans.get(row.id) ?? null;
  const listRuns: readonly TaskListRun[] = runs;
  const events = [
    ...(facts.approvals.get(row.id) ?? []),
    ...checkEvents(facts.artifacts.check.get(row.id) ?? []),
    ...shortcutEvents(facts.artifacts.shortcuts.get(row.id) ?? []),
  ];
  const items = taskList({ status: row.status, links }, listRuns, events, plan);
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
    items,
    summary: taskSummary(items, listRuns),
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
  const [facts, versions] = await Promise.all([
    loadTaskFacts(db, row.conversation_id, [taskId]),
    planVersions(db, taskId),
  ]);
  return {
    ...overview(row, facts),
    runs: (facts.runs.get(taskId) ?? []).map((run) => taskRunSchema.parse(run)),
    planVersions: versions,
    links: facts.links.get(taskId) ?? [],
  };
}
