import {
  categorySchema,
  titleSourceSchema,
  type AgentRole,
  type Attachment,
  type ConversationSummary,
  type CostSource,
  type InvolvementLevel,
  type Message,
  type Run,
  type RunMode,
  type RunStatus,
  type RunUsage,
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
  mode?: RunMode | null;
  level?: InvolvementLevel | null;
  snapshot_kind?: 'git' | 'files' | null;
  reverted_at?: Date | null;
  parent_run_id?: string | null;
  role?: AgentRole | null;
  step_index?: number | null;
  agent_label?: string | null;
  category?: string | null;
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
  archived_at: Date | null;
  pinned_at: Date | null;
  pinned_order: number | null;
  unread: boolean;
  needs_input: boolean;
  title_source: string;
  category: string | null;
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
    level: row.level ?? null,
    snapshot: row.snapshot_kind ?? null,
    revertedAt: iso(row.reverted_at ?? null),
    parentRunId: row.parent_run_id ?? null,
    role: row.role ?? null,
    stepIndex: row.step_index ?? null,
    agentLabel: row.agent_label ?? null,
    category: categorySchema.safeParse(row.category).data ?? null,
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
            step: row.latest_run_step,
          }
        : null,
    archivedAt: iso(row.archived_at),
    pinnedAt: iso(row.pinned_at),
    pinnedOrder: row.pinned_order,
    unread: row.unread,
    needsInput: row.needs_input,
    attention: row.needs_input ? toAttention(row) : null,
    titleSource: titleSourceSchema.safeParse(row.title_source).data ?? 'message',
    category: categorySchema.safeParse(row.category).data ?? null,
  };
}
