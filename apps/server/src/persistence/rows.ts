import {
  friendlyStep,
  agentRoleSchema,
  categorySchema,
  modelSwitchSchema,
  faceFromName,
  teammateFaceSchema,
  titleSourceSchema,
  type AgentRole,
  type Attachment,
  type ConversationSummary,
  type CostSource,
  type InterruptionChoice,
  type InvolvementLevel,
  type Message,
  type Run,
  type RunMode,
  type RunStatus,
  type RunUsage,
  type StartAs,
  type TeammateTag,
  type TokenUsage,
} from '@spark-outpost/contracts';
import { toAttention, type PendingApprovalRow } from './attention.ts';

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
  user_message_id: string;
  provider: string;
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
  cost_source?: CostSource | null;
  outpost_post_id?: string | null;
  outpost_id?: string | null;
  outpost_name?: string | null;
  outpost_from_handle?: string | null;
  outpost_from_user?: boolean | null;
  outpost_user_started?: boolean | null;
  outpost_from_spark?: boolean | null;
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
  category?: string | null;
  followed_instructions?: string[] | null;
  continues_run_id?: string | null;
  interruption_choice?: InterruptionChoice | null;
  model_switch?: unknown;
  error_details?: string | null;
}

export interface ConversationSummaryRow extends PendingApprovalRow {
  id: string;
  title: string;
  updated_at: Date;
  project_ids: string[];
  latest_run_id: string | null;
  latest_run_status: RunStatus | null;
  latest_run_error: string | null;
  latest_run_step: string | null;
  latest_run_provider: string | null;
  latest_run_interruption_choice?: InterruptionChoice | null;
  latest_run_needs_you?: string | null;
  latest_run_progress: { done: number; active: number; total: number } | null;
  archived_at: Date | null;
  pinned_at: Date | null;
  pinned_order: number | null;
  project_order: number | null;
  unread: boolean;
  needs_input: boolean;
  pull_request_merged: boolean;
  title_source: string;
  category: string | null;
  outpost_id?: string | null;
  outpost_name?: string | null;
  outpost_handle?: string | null;
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
    continuesRunId: row.continues_run_id ?? null,
    interruptionChoice: row.interruption_choice ?? null,
    modelSwitch: modelSwitchSchema.safeParse(row.model_switch).data ?? null,
    errorDetails: row.error_details ?? null,
    ...runOutpost(row),
  };
}

export const RUN_OUTPOST_COLUMNS = `post.id AS outpost_post_id, post.outpost_id,
  room.name AS outpost_name, post.from_handle AS outpost_from_handle,
  post.from_user AS outpost_from_user, post.user_started AS outpost_user_started,
  EXISTS (SELECT 1 FROM outpost_drafts wrap WHERE wrap.id = post.id) AS outpost_from_spark`;

export const RUN_OUTPOST_JOINS = `LEFT JOIN outpost_posts post
    ON r.source = 'outpost' AND post.id = r.user_message_id
  LEFT JOIN outposts room ON room.id = post.outpost_id`;

function runOutpost(row: RunRow): Pick<Run, 'outpost'> {
  if (!row.outpost_post_id || !row.outpost_id || typeof row.outpost_name !== 'string') return {};
  return {
    outpost: {
      postId: row.outpost_post_id,
      outpostId: row.outpost_id,
      outpostName: row.outpost_name,
      fromHandle: row.outpost_from_handle ?? null,
      fromUser: row.outpost_from_user === true,
      fromSpark: row.outpost_from_spark === true,
      userStarted: row.outpost_user_started === true,
    },
  };
}

function toTokenUsage(row: RunRow): TokenUsage | null {
  if (row.input_tokens === null || row.output_tokens === null) return null;
  return {
    input: row.input_tokens,
    output: row.output_tokens,
    total: row.total_tokens ?? row.input_tokens + row.output_tokens,
    cachedRead: row.cached_read_tokens,
    cachedWrite: row.cached_write_tokens,
    thought: row.thought_tokens,
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
            step: row.latest_run_step === null ? null : friendlyStep(row.latest_run_step),
            provider: row.latest_run_provider,
            progress:
              row.latest_run_progress && row.latest_run_progress.total > 0
                ? row.latest_run_progress
                : null,
            interruptionChoice: row.latest_run_interruption_choice ?? null,
            needsYou: row.latest_run_needs_you ?? null,
          }
        : null,
    archivedAt: iso(row.archived_at),
    pinnedAt: iso(row.pinned_at),
    pinnedOrder: row.pinned_order,
    projectOrder: row.project_order,
    unread: row.unread,
    needsInput: row.needs_input,
    attention: row.needs_input ? toAttention(row) : null,
    titleSource: titleSourceSchema.safeParse(row.title_source).data ?? 'message',
    category: categorySchema.safeParse(row.category).data ?? null,
    teammate: toTeammateTag(row),
    pullRequestMerged: row.pull_request_merged,
    ...(row.outpost_id && row.outpost_handle && typeof row.outpost_name === 'string'
      ? { outpost: { id: row.outpost_id, name: row.outpost_name, handle: row.outpost_handle } }
      : {}),
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
