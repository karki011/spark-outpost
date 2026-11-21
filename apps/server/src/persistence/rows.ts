import {
  friendlyStep,
  agentRoleSchema,
  categorySchema,
  modelSwitchSchema,
  needsYouLines,
  faceFromName,
  teammateFaceSchema,
  titleSourceSchema,
  todoListSchema,
  subagentWaitSchema,
  waitingOnLabel,
  agentsWorkingLabel,
  applySubagentEvent,
  emptySubagentRoster,
  parseRunEvent,
  rosterCounts,
  type AgentRole,
  type Attachment,
  type ConversationSummary,
  type CostSource,
  type InterruptionChoice,
  type InvolvementLevel,
  type Message,
  type PlanProgress,
  type Run,
  type RunMode,
  type RunStatus,
  type RunUsage,
  type StartAs,
  type TeammateTag,
  type TokenUsage,
} from '@spark-outpost/contracts';
import { toAttention, type PendingApprovalRow } from './attention.ts';
import { subChatFields, type SubChatSummaryRow } from './sub-chat-facts.ts';

export const MESSAGE_COLUMNS = 'id, conversation_id, role, content, run_id, created_at';

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  run_id: string | null;
  created_at: Date;
}

export interface RunRow {
  id: string;
  conversation_id: string;
  user_message_id: string | null;
  provider: string;
  source?: string | null;
  from_chat?: string | null;
  todo?: unknown;
  status: RunStatus;
  error: string | null;
  cancel_requested_at: Date | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  model: string | null;
  effort: string | null;
  context_used: number | null;
  context_size: number | null;
  cost_usd: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
  thought_tokens: number | null;
  subagent_tokens?: number | null;
  cost_source?: CostSource | null;
  mode?: RunMode | null;
  picked_mode?: RunMode | null;
  start_as?: StartAs | null;
  level?: InvolvementLevel | null;
  snapshot_kind?: 'git' | 'files' | null;
  reverted_at?: Date | null;
  parent_run_id?: string | null;
  role?: AgentRole | null;
  step_index?: number | null;
  agent_label?: string | null;
  used_model?: string | null;
  category?: string | null;
  followed_instructions?: string[] | null;
  continues_run_id?: string | null;
  interruption_choice?: InterruptionChoice | null;
  model_switch?: unknown;
  error_details?: string | null;
}

export interface ConversationSummaryRow extends PendingApprovalRow, SubChatSummaryRow {
  id: string;
  shell_alert?: string | null;
  title: string;
  updated_at: Date;
  project_ids: string[];
  latest_run_id: string | null;
  latest_run_status: RunStatus | null;
  latest_run_error: string | null;
  latest_run_step: string | null;
  latest_run_wait?: unknown;
  latest_run_agents?: unknown;
  latest_run_provider: string | null;
  latest_run_agent_mode?: string | null;
  latest_run_interruption_choice?: InterruptionChoice | null;
  latest_run_asking_reply?: string | null;
  latest_run_progress: {
    done: number;
    active: number;
    total: number;
    doing?: string | null;
  } | null;
  archived_at: Date | null;
  auto_archived_days?: number | null;
  pinned_at: Date | null;
  pinned_order: number | null;
  project_order: number | null;
  unread: boolean;
  assistant?: boolean;
  seen_at?: Date | null;
  latest_run_finished_at?: Date | null;
  waiting_since?: Date | null;
  needs_input: boolean;
  pull_request_merged: boolean;
  title_source: string;
  category: string | null;
  teammate_id: string | null;
  teammate_name: string | null;
  teammate_role: string | null;
  teammate_shape: string | null;
  teammate_color: string | null;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toMessage(row: MessageRow, attachments: Attachment[] = []): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    runId: row.run_id,
    createdAt: row.created_at.toISOString(),
    attachments,
  };
}

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    provider: row.provider,
    status: row.status,
    error: row.error,
    cancelRequested: row.cancel_requested_at !== null,
    createdAt: row.created_at.toISOString(),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    model: row.model,
    usedModel: row.used_model ?? null,
    effort: row.effort,
    usage: toRunUsage(row),
    mode: row.mode ?? null,
    pickedMode: row.picked_mode ?? null,
    startAs: row.start_as ?? null,
    level: row.level ?? null,
    snapshot: row.snapshot_kind ?? null,
    revertedAt: iso(row.reverted_at ?? null),
    parentRunId: row.parent_run_id ?? null,
    role: agentRoleSchema.safeParse(row.role).data ?? null,
    stepIndex: row.step_index ?? null,
    agentLabel: row.agent_label ?? null,
    category: categorySchema.safeParse(row.category).data ?? null,
    following: row.followed_instructions ?? null,
    todo: todoListSchema.safeParse(row.todo).data ?? null,
    continuesRunId: row.continues_run_id ?? null,
    interruptionChoice: row.interruption_choice ?? null,
    modelSwitch: modelSwitchSchema.safeParse(row.model_switch).data ?? null,
    errorDetails: row.error_details ?? null,
    ...(row.source === 'agent_cycle' ? { agentCycle: true } : {}),
    ...(row.source === 'pr_follow_up' ? { prFollowUp: true } : {}),
    ...(row.source === 'workflow' ? { workflowStarted: true } : {}),
    ...(row.source === 'ui' ? { typedByUser: true } : {}),
    ...(row.source === 'chat' ? { fromChat: row.from_chat ?? 'another chat' } : {}),
  };
}

export const RUN_FROM_CHAT_COLUMN = `(SELECT COALESCE(sender.title, ask.from_title)
  FROM chat_asks ask LEFT JOIN conversations sender ON sender.id = ask.from_conversation_id
  WHERE ask.id = r.user_message_id) AS from_chat`;

function toTokenUsage(row: RunRow): TokenUsage | null {
  if (row.input_tokens === null || row.output_tokens === null) return null;
  return {
    input: row.input_tokens,
    output: row.output_tokens,
    total: row.total_tokens ?? row.input_tokens + row.output_tokens,
    cachedRead: row.cached_read_tokens,
    cachedWrite: row.cached_write_tokens,
    thought: row.thought_tokens,
    ...(row.subagent_tokens ? { subagents: Number(row.subagent_tokens) } : {}),
  };
}

function toRunUsage(row: RunRow): RunUsage | null {
  const tokens = toTokenUsage(row);
  const costUsd = row.cost_usd === null ? null : Number(row.cost_usd);
  if (row.context_size === null && tokens === null && costUsd === null) return null;
  return {
    contextUsed: row.context_used,
    contextSize: row.context_size,
    costUsd,
    costSource: row.cost_source ?? null,
    tokens,
  };
}

function latestWait(row: ConversationSummaryRow) {
  const parsed = subagentWaitSchema.safeParse(row.latest_run_wait);
  return parsed.success && parsed.data.waitingOn > 0 ? parsed.data : null;
}

function latestAgents(row: ConversationSummaryRow): { working: number; total: number } {
  const events = Array.isArray(row.latest_run_agents) ? row.latest_run_agents : [];
  let roster = emptySubagentRoster;
  for (const payload of events) {
    const event = parseRunEvent(payload);
    if (event) roster = applySubagentEvent(roster, event);
  }
  return rosterCounts(roster);
}

function latestProgress(row: ConversationSummaryRow): PlanProgress | null {
  const progress = row.latest_run_progress;
  if (!progress || progress.total <= 0) return null;
  return { done: progress.done, active: progress.active, total: progress.total };
}

function latestDoing(row: ConversationSummaryRow): string | null {
  const doing = row.latest_run_progress?.doing?.replace(/\s+/g, ' ').trim();
  return doing ? doing : null;
}

function latestStep(row: ConversationSummaryRow): string | null {
  const wait = latestWait(row);
  const agents = latestAgents(row);
  if (wait && agents.working > 0 && !wait.background) {
    return agentsWorkingLabel(agents.working, agents.total);
  }
  if (wait) return waitingOnLabel(wait.waitingOn, wait.background);
  return row.latest_run_step === null ? null : friendlyStep(row.latest_run_step);
}

export function toConversationSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at.toISOString(),
    projectIds: row.project_ids,
    latestRun:
      row.latest_run_id && row.latest_run_status
        ? {
            id: row.latest_run_id,
            status: row.latest_run_status,
            error: row.latest_run_error,
            step: latestStep(row),
            provider: row.latest_run_provider,
            agentMode: row.latest_run_agent_mode ?? null,
            progress: latestProgress(row),
            doing: latestDoing(row),
            interruptionChoice: row.latest_run_interruption_choice ?? null,
            needsYou: needsYouLines(row.latest_run_asking_reply ?? '')[0] ?? null,
            ...latestWait(row),
            finishedAt: iso(row.latest_run_finished_at ?? null),
          }
        : null,
    archivedAt: iso(row.archived_at),
    ...(row.archived_at && row.auto_archived_days
      ? { autoArchivedDays: row.auto_archived_days }
      : {}),
    pinnedAt: iso(row.pinned_at),
    pinnedOrder: row.pinned_order,
    projectOrder: row.project_order,
    unread: row.unread,
    ...(row.assistant ? { assistant: true } : {}),
    seenAt: iso(row.seen_at ?? null),
    waitingSince: row.needs_input ? iso(row.waiting_since ?? null) : null,
    needsInput: row.needs_input,
    attention: row.needs_input || row.flag_title ? toAttention(row) : null,
    ...(row.shell_alert ? { shellAlert: row.shell_alert } : {}),
    titleSource: titleSourceSchema.safeParse(row.title_source).data ?? 'message',
    category: categorySchema.safeParse(row.category).data ?? null,
    teammate: toTeammateTag(row),
    pullRequestMerged: row.pull_request_merged,
    ...subChatFields(row, {
      archived: row.archived_at !== null,
      needsInput: row.needs_input,
      runStatus: row.latest_run_status,
    }),
  };
}

function toTeammateTag(row: ConversationSummaryRow): TeammateTag | null {
  if (!row.teammate_id || row.teammate_name === null) return null;
  const face = teammateFaceSchema.safeParse({
    shape: row.teammate_shape,
    color: row.teammate_color,
  });
  return {
    id: row.teammate_id,
    name: row.teammate_name,
    role: row.teammate_role ?? '',
    face: face.data ?? faceFromName(row.teammate_name),
  };
}
