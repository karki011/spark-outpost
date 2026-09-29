import {
  checkBodySchema,
  shortcutsBodySchema,
  shortcutsLine,
  shortcutText,
  checkLine,
  failingChecks,
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
} from '@spark-outpost/contracts';
import { latestPlan, planVersions } from './artifacts.ts';
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
  run_id: string;
  kind: string;
  title: string;
  status: ApprovalStatus;
  option_name: string | null;
  full_paths: string[] | null;
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

async function approvalEvents(db: Queryable, taskId: string): Promise<TaskListEvent[]> {
  const { rows } = await db.query<ApprovalEventRow>(
    `SELECT a.id, a.run_id, a.kind, a.title, a.status, a.payload->'fullPaths' AS full_paths,
       (SELECT o->>'name' FROM jsonb_array_elements(a.options) o
        WHERE o->>'optionId' = a.decision_option_id LIMIT 1) AS option_name
     FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.task_id = $1 AND (a.status = 'pending' OR a.decided_by IN ('user', 'auto'))
     ORDER BY a.created_at`,
    [taskId],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: 'waiting',
    runId: row.run_id,
    state: APPROVAL_STATES[row.status],
    ...(row.full_paths?.length ? { hint: row.full_paths.join('\n') } : {}),
    ...(row.kind === 'execute' ? { command: true } : {}),
    ...(row.status === 'pending' ? {} : { detail: approvalDecision(row) }),
    label: row.status === 'pending' ? `Waiting for you: ${row.title}` : row.title,
  }));
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

async function taskArtifactBodies(
  db: Queryable,
  taskId: string,
  kind: 'check' | 'shortcuts',
): Promise<{ version: number; body: unknown }[]> {
  const { rows } = await db.query<{ version: number; body: unknown }>(
    `SELECT version, body FROM run_artifacts WHERE task_id = $1 AND kind = $2
     ORDER BY version`,
    [taskId, kind],
  );
  return rows;
}

async function checkEvents(db: Queryable, taskId: string): Promise<TaskListEvent[]> {
  const rows = await taskArtifactBodies(db, taskId, 'check');
  return rows.flatMap((row) => {
    const parsed = checkBodySchema.safeParse(row.body);
    if (!parsed.success) return [];
    const body = parsed.data;
    const output = checkOutput(failingChecks(body).map((result) => result.outputTail));
    const notes = body.results.flatMap((result) => (result.note ? [result.note] : []));
    return [
      {
        id: String(row.version),
        kind: 'check' as const,
        runId: body.runId,
        label: checkLine(body),
        state: body.status === 'failed' ? ('failed' as const) : ('done' as const),
        detail: `round ${body.round}${notes.length > 0 ? ` · ${notes.join(' ')}` : ''}`,
        ...(output ? { output } : {}),
      },
    ];
  });
}

async function shortcutEvents(db: Queryable, taskId: string): Promise<TaskListEvent[]> {
  const rows = await taskArtifactBodies(db, taskId, 'shortcuts');
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

async function overview(
  db: Queryable,
  row: TaskRow,
  runs: readonly TaskRunView[],
  links: readonly TaskLink[],
): Promise<TaskOverview> {
  const plan = await latestPlan(db, row.id);
  const agreed = await latestApprovedPlan(db, row.conversation_id);
  const listRuns: readonly TaskListRun[] = runs;
  const events = [
    ...(await approvalEvents(db, row.id)),
    ...(await checkEvents(db, row.id)),
    ...(await shortcutEvents(db, row.id)),
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
    agreedPlanVersion: agreed?.version ?? null,
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
  const ids = rows.map((row) => row.id);
  const [runs, links] = await Promise.all([loadRuns(db, ids), taskLinks(db, ids)]);
  return Promise.all(
    rows.map((row) => overview(db, row, runs.get(row.id) ?? [], links.get(row.id) ?? [])),
  );
}

export async function getTaskDetail(db: Queryable, taskId: string): Promise<TaskDetail | null> {
  const { rows } = await db.query<TaskRow>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const row = rows[0];
  if (!row) return null;
  const [runs, links, versions] = await Promise.all([
    loadRuns(db, [taskId]),
    taskLinks(db, [taskId]),
    planVersions(db, taskId),
  ]);
  const taskRuns = runs.get(taskId) ?? [];
  const taskLinkList = links.get(taskId) ?? [];
  return {
    ...(await overview(db, row, taskRuns, taskLinkList)),
    runs: taskRuns.map((run) => taskRunSchema.parse(run)),
    planVersions: versions,
    links: taskLinkList,
  };
}
