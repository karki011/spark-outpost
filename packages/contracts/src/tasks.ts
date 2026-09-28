import { z } from 'zod';
import { advisorUsageSchema } from './advice.ts';
import { runModeSchema } from './approvals.ts';
import { planVersionSchema, type PlanEntry } from './artifacts.ts';
import { agreedPlansSchema } from './plans.ts';
import { costSourceSchema, totalCostSourceSchema, type CostSource } from './audit.ts';
import { agentRoleSchema, type AgentRole } from './roles.ts';
import { runStatusSchema, type RunStatus } from './runs.ts';

export const TASK_TITLE_MAX_LENGTH = 80;
export const LINK_TITLE_MAX_LENGTH = 200;

export const taskStatusSchema = z.enum(['open', 'closed']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskItemStateSchema = z.enum(['done', 'active', 'waiting', 'pending', 'failed']);
export type TaskItemState = z.infer<typeof taskItemStateSchema>;

export const taskAgentSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
});
export type TaskAgent = z.infer<typeof taskAgentSchema>;

export const taskListItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: taskItemStateSchema,
  detail: z.string().optional(),
  hint: z.string().optional(),
  output: z.string().optional(),
  command: z.boolean().optional(),
  agent: taskAgentSchema.optional(),
  role: agentRoleSchema.optional(),
  runId: z.uuid().optional(),
  name: z.string().optional(),
  tokens: z.number().optional(),
  costUsd: z.number().optional(),
  costSource: costSourceSchema.optional(),
});
export type TaskListItem = z.infer<typeof taskListItemSchema>;

export const taskLinkKindSchema = z.enum(['pr', 'link']);
export const taskLinkSourceSchema = z.enum([
  'tool_output',
  'resource_link',
  'agent_text',
  'user',
  'ship',
]);
export type TaskLinkSource = z.infer<typeof taskLinkSourceSchema>;

export const taskLinkSchema = z.object({
  id: z.uuid(),
  kind: taskLinkKindSchema,
  url: z.string(),
  title: z.string().nullable(),
  source: taskLinkSourceSchema,
  createdAt: z.string(),
});
export type TaskLink = z.infer<typeof taskLinkSchema>;

export const taskSummarySchema = z.object({
  done: z.number().int(),
  total: z.number().int(),
  waiting: z.number().int(),
  text: z.string(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskOverviewSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  title: z.string(),
  status: taskStatusSchema,
  createdAt: z.string(),
  closedAt: z.string().nullable(),
  runIds: z.array(z.uuid()),
  planVersion: z.number().int().nullable(),
  agreedPlanVersion: z.number().int().nullable().optional(),
  items: z.array(taskListItemSchema),
  summary: taskSummarySchema,
  costUsd: z.number().nullable(),
  costSource: totalCostSourceSchema.nullable().optional(),
  tokens: z.number().nullable(),
});
export type TaskOverview = z.infer<typeof taskOverviewSchema>;

export const taskRunSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  status: runStatusSchema,
  planVersion: z.number().int().nullable(),
  tokens: z.number().nullable(),
  costUsd: z.number().nullable(),
  costSource: costSourceSchema.nullable().optional(),
  mode: runModeSchema.nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  createdAt: z.string(),
});
export type TaskRun = z.infer<typeof taskRunSchema>;

export const taskDetailSchema = taskOverviewSchema.extend({
  runs: z.array(taskRunSchema),
  planVersions: z.array(planVersionSchema),
  links: z.array(taskLinkSchema),
  agreedPlans: agreedPlansSchema.optional(),
  advisors: z.array(advisorUsageSchema).optional(),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const addTaskLinkRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2000),
  title: z.string().trim().max(LINK_TITLE_MAX_LENGTH).optional(),
});
export type AddTaskLinkRequest = z.infer<typeof addTaskLinkRequestSchema>;

export interface TaskListRun {
  id: string;
  provider: string;
  model: string | null;
  effort: string | null;
  status: RunStatus;
  tokens: number | null;
  costUsd: number | null;
  costSource?: CostSource | null | undefined;
  request: string;
  label?: string | null | undefined;
  step?: string | null | undefined;
  role?: AgentRole | null | undefined;
  name?: string | null | undefined;
}

export interface TaskListEvent {
  id: string;
  kind: 'waiting' | 'check' | 'review' | 'shortcut';
  label: string;
  state: TaskItemState;
  runId: string;
  hint?: string;
  detail?: string;
  output?: string;
  command?: boolean;
}

export interface TaskListTask {
  status: TaskStatus;
  links: readonly Pick<TaskLink, 'kind' | 'url' | 'title'>[];
}

export interface TaskListPlan {
  version: number;
  entries: readonly PlanEntry[];
  sourceRunId: string | null;
}

const providerLabels: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  jev: 'Jev',
  fake: 'Fake provider',
};

export function providerLabel(provider: string): string {
  return providerLabels[provider] ?? provider;
}

const liveStatuses: ReadonlySet<RunStatus> = new Set(['queued', 'running', 'awaiting_approval']);

const runStates: Record<RunStatus, TaskItemState> = {
  queued: 'pending',
  running: 'active',
  awaiting_approval: 'waiting',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'failed',
  outcome_unknown: 'failed',
};

const runVerbs: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Working',
  awaiting_approval: 'Waiting for you',
  succeeded: 'Replied',
  failed: 'Hit a problem',
  cancelled: 'Stopped',
  outcome_unknown: 'Outcome unknown',
};

function agentOf(run: TaskListRun): TaskAgent {
  return { provider: run.provider, model: run.model, effort: run.effort };
}

function ownerOf(run: TaskListRun): Pick<TaskListItem, 'agent' | 'role' | 'runId' | 'name'> {
  return {
    agent: agentOf(run),
    runId: run.id,
    ...(run.role ? { role: run.role } : {}),
    ...(run.name ? { name: run.name } : {}),
  };
}

function excerpt(text: string, max = 60): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function usage(run: TaskListRun): Pick<TaskListItem, 'tokens' | 'costUsd'> {
  return {
    ...(run.tokens !== null ? { tokens: run.tokens } : {}),
    ...(run.costUsd !== null ? { costUsd: run.costUsd } : {}),
    ...(run.costUsd !== null && run.costSource ? { costSource: run.costSource } : {}),
  };
}

function understoodItem(runs: readonly TaskListRun[]): TaskListItem {
  const first = runs[0];
  const state: TaskItemState = !first ? 'pending' : first.status === 'queued' ? 'active' : 'done';
  return { id: 'understood', label: 'Understood the request', state };
}

function entryState(entry: PlanEntry, live: boolean, stopped: boolean): TaskItemState {
  if (entry.status === 'completed') return 'done';
  if (entry.status === 'failed') return 'failed';
  if (entry.status === 'pending') return 'pending';
  if (live) return 'active';
  return stopped ? 'failed' : 'pending';
}

function planItems(plan: TaskListPlan, runs: readonly TaskListRun[]): TaskListItem[] {
  const source =
    runs.find((run) => run.id === plan.sourceRunId && run.role !== 'builder') ??
    runs.findLast((run) => run.role === 'architect');
  const agent = source ? { agent: agentOf(source) } : {};
  const owner = source ? ownerOf(source) : {};
  const started = new Set(runs.flatMap((run) => (run.step ? run.step.split('\n') : [])));
  const live = runs.some((run) => liveStatuses.has(run.status));
  const last = runs.at(-1);
  const stopped = !!last && runStates[last.status] === 'failed';
  return [
    {
      id: 'planned',
      label: 'Made a plan',
      state: 'done',
      detail: `plan v${plan.version}`,
      ...owner,
    },
    ...plan.entries.flatMap((entry, index): TaskListItem[] =>
      started.has(entry.content)
        ? []
        : [
            {
              id: `plan:${index}`,
              label: entry.content,
              state: entryState(entry, live, stopped),
              ...agent,
            },
          ],
    ),
  ];
}

function runLabel(run: TaskListRun, index: number): string {
  if (run.label) return run.step ? `${run.label}: ${excerpt(run.step)}` : run.label;
  const followUp = index > 0 && run.request.trim() !== '';
  return followUp ? `Follow-up: ${excerpt(run.request)}` : 'Worked on the request';
}

function runItem(run: TaskListRun, index: number, asking: ReadonlySet<string>): TaskListItem {
  const waitingElsewhere = run.status === 'awaiting_approval' && asking.has(run.id);
  return {
    id: `run:${run.id}`,
    label: runLabel(run, index),
    state: waitingElsewhere ? 'active' : runStates[run.status],
    detail: runVerbs[run.status],
    ...ownerOf(run),
    ...usage(run),
  };
}

function prItems(task: TaskListTask): TaskListItem[] {
  return task.links
    .filter((link) => link.kind === 'pr')
    .map((link) => ({
      id: `pr:${link.url}`,
      label: `Opened ${link.title ?? 'a pull request'}`,
      state: 'done',
    }));
}

export function taskList(
  task: TaskListTask,
  runs: readonly TaskListRun[],
  events: readonly TaskListEvent[],
  plan: TaskListPlan | null,
): TaskListItem[] {
  const asking = new Set(
    events.filter((event) => event.state === 'waiting').map((event) => event.runId),
  );
  return [
    understoodItem(runs),
    ...(plan && plan.entries.length > 0 ? planItems(plan, runs) : []),
    ...events.map((event): TaskListItem => ({
      id: `${event.kind}:${event.id}`,
      label: event.label,
      state: event.state,
      runId: event.runId,
      ...(event.hint ? { hint: event.hint } : {}),
      ...(event.detail ? { detail: event.detail } : {}),
      ...(event.output ? { output: event.output } : {}),
      ...(event.command ? { command: true } : {}),
    })),
    ...runs.map((run, index) => runItem(run, index, asking)),
    ...prItems(task),
  ];
}

export function taskSummary(
  items: readonly TaskListItem[],
  runs: readonly TaskListRun[],
): TaskSummary {
  const done = items.filter((item) => item.state === 'done').length;
  const waiting = items.filter((item) => item.state === 'waiting').length;
  const counts = `${done} of ${items.length} done`;
  const live =
    runs.find((run) => run.status === 'running') ?? runs.find((run) => run.status === 'queued');
  const last = runs.at(-1);
  let status = '';
  if (waiting > 0) status = 'Waiting for you';
  else if (live)
    status = `${live.name ?? providerLabel(live.provider)} ${live.status === 'running' ? 'working' : 'queued'}`;
  else if (last && runStates[last.status] === 'failed') status = runVerbs[last.status];
  return { done, total: items.length, waiting, text: status ? `${counts} · ${status}` : counts };
}

export function waitingApprovalId(item: Pick<TaskListItem, 'id'>): string | null {
  const prefix = 'waiting:';
  return item.id.startsWith(prefix) ? item.id.slice(prefix.length) : null;
}
