import { z } from 'zod';
import { advisorUsageSchema } from './advice.ts';
import { runModeSchema } from './approvals.ts';
import { planVersionSchema, type PlanEntry } from './artifacts.ts';
import { agreedPlansSchema } from './plans.ts';
import { costSourceSchema, totalCostSourceSchema } from './audit.ts';
import { runStatusSchema, type RunStatus } from './runs.ts';

export const TASK_TITLE_MAX_LENGTH = 120;
export const LINK_TITLE_MAX_LENGTH = 200;

export const taskStatusSchema = z.enum(['open', 'closed']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskItemStateSchema = z.enum(['done', 'active', 'waiting', 'pending', 'failed']);
export type TaskItemState = z.infer<typeof taskItemStateSchema>;

export const taskListItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: taskItemStateSchema,
  detail: z.string().optional(),
  hint: z.string().optional(),
  output: z.string().optional(),
  command: z.boolean().optional(),
  action: z.boolean().optional(),
  url: z.string().optional(),
});
export type TaskListItem = z.infer<typeof taskListItemSchema>;

export const taskLinkKindSchema = z.enum(['pr', 'link', 'file', 'folder']);
export const taskLinkSourceSchema = z.enum([
  'tool_output',
  'resource_link',
  'agent_text',
  'user',
  'ship',
  'ticket',
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
  todo: z.array(taskListItemSchema),
  recorded: z.array(taskListItemSchema),
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
  status: RunStatus;
  name?: string | null | undefined;
}

export interface TaskListEvent {
  id: string;
  kind: 'waiting';
  label: string;
  state: TaskItemState;
  hint?: string;
  detail?: string;
  command?: boolean;
  action?: boolean;
  url?: string;
}

export interface TaskListPlan {
  entries: readonly PlanEntry[];
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

const stoppedVerbs: Partial<Record<RunStatus, string>> = {
  failed: 'Hit a problem',
  cancelled: 'Stopped',
  outcome_unknown: 'Outcome unknown',
};

function todoState(entry: PlanEntry, live: boolean): TaskItemState {
  if (entry.status === 'completed') return 'done';
  if (entry.status === 'failed') return 'failed';
  if (entry.status === 'in_progress' && live) return 'active';
  return 'pending';
}

export function todoItems(
  plan: TaskListPlan | null,
  runs: readonly Pick<TaskListRun, 'status'>[],
): TaskListItem[] {
  if (!plan) return [];
  const live = runs.some((run) => liveStatuses.has(run.status));
  return plan.entries.map((entry, index) => ({
    id: `todo:${index}`,
    label: entry.content,
    state: todoState(entry, live),
  }));
}

export function recordedItems(events: readonly TaskListEvent[]): TaskListItem[] {
  return events.map((event) => ({
    id: `${event.kind}:${event.id}`,
    label: event.label,
    state: event.state,
    ...(event.hint ? { hint: event.hint } : {}),
    ...(event.detail ? { detail: event.detail } : {}),
    ...(event.command ? { command: true } : {}),
    ...(event.action ? { action: true } : {}),
    ...(event.url ? { url: event.url } : {}),
  }));
}

function runStatusText(runs: readonly TaskListRun[]): string {
  const live =
    runs.find((run) => run.status === 'running') ?? runs.find((run) => run.status === 'queued');
  if (live) {
    const who = live.name ?? providerLabel(live.provider);
    return `${who} ${live.status === 'running' ? 'working' : 'queued'}`;
  }
  const last = runs.at(-1);
  return (last && stoppedVerbs[last.status]) ?? '';
}

export function taskSummary(
  todo: readonly TaskListItem[],
  recorded: readonly TaskListItem[],
  runs: readonly TaskListRun[],
): TaskSummary {
  const done = todo.filter((item) => item.state === 'done').length;
  const waiting = recorded.filter((item) => item.state === 'waiting').length;
  const status = waiting > 0 ? 'Waiting for you' : runStatusText(runs);
  const counts = todo.length > 0 ? `${done} of ${todo.length} done` : '';
  return {
    done,
    total: todo.length,
    waiting,
    text: [counts, status].filter(Boolean).join(' · '),
  };
}

export function waitingApprovalId(item: Pick<TaskListItem, 'id'>): string | null {
  const prefix = 'waiting:';
  return item.id.startsWith(prefix) ? item.id.slice(prefix.length) : null;
}
