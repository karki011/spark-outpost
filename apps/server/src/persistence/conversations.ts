import { promptCacheFor } from './prompt-cache.ts';
import {
  PERMISSION_DO,
  UNTITLED_CONVERSATION,
  titleFromMessage,
  type ConfigValues,
  type InvolvementLevel,
  type ModelSwitch,
  type RunMode,
  type ConversationDetail,
  type ConversationSummary,
  type MessageSource,
  type SendMessageRequest,
  type SendMessageResponse,
  type StartAs,
  type CreateConversationRequest,
} from '@spark-outpost/contracts';
import { conversationSubagents } from './subagents.ts';
import { activityFromEvents, type StepEventRow } from './activity.ts';
import { nativeStepActivity } from './native-terminal-steps.ts';
import { STEP_NOT_INTERRUPTED } from './run-events.ts';
import { conversationAdvice } from './advice.ts';
import { insertAnnotations } from './annotations.ts';
import { conversationPlans } from './plan-documents.ts';
import { conversationOrchestrations } from './orchestrations.ts';
import { shownApprovalsForConversation } from './approvals.ts';
import { attachmentsForMessages, linkAttachments } from './attachments.ts';
import { resolveChatSettings } from './chat-settings.ts';
import { withChatBranches } from './chat-worktrees.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { listCompactions, listContinuations } from './compactions.ts';
import { listBrowserShots } from './browser-screenshots.ts';
import { listCommands } from './run-commands.ts';
import { listRailFlags } from './rail-flags.ts';
import { newId } from './ids.ts';
import { CHAT_LIST_LIMIT, LISTED_CHAT, searchConversations } from './conversation-search.ts';
import { summaryQuery } from './summary-query.ts';
import { taskForNewRun } from './tasks.ts';
import { listQueue } from './chat-queue.ts';
import { listMemberMessages } from './member-messages.ts';
import { taskOverviews } from './task-views.ts';
import { conversationUsage } from './usage.ts';
import { findInterruption } from './interruptions.ts';
import { withNativeTerminals } from './native-terminals.ts';
import { applyConversationOptions } from './conversation-options.ts';
import { continueOpenRequest } from '../outposts/continuation.ts';
import { deviceStartingRun } from '../remote/run-mark.ts';
import {
  MESSAGE_COLUMNS,
  RUN_OUTPOST_COLUMNS,
  RUN_OUTPOST_JOINS,
  toConversationSummary,
  toMessage,
  toRun,
  type ConversationSummaryRow,
  type MessageRow,
  type RunRow,
} from './rows.ts';

const LOCAL_WORKSPACE_SLUG = 'local';
const TERMINAL_RUN_LEVEL: InvolvementLevel = 'hands-off';

export class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`Conversation ${id} was not found.`);
  }
}

export class MessageConflictError extends Error {
  constructor(id: string) {
    super(`Message ${id} already exists with different content or conversation.`);
  }
}

export async function ensureLocalWorkspace(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, 'Local')
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING id`,
    [newId(), LOCAL_WORKSPACE_SLUG],
  );
  return rows[0]!.id;
}

export async function listConversations(
  db: Queryable,
  workspaceId: string,
  search = '',
): Promise<ConversationSummary[]> {
  const text = search.trim();
  if (text !== '') return searchConversations(db, workspaceId, text);
  const { rows } = await db.query<ConversationSummaryRow>(
    `${summaryQuery} WHERE ${LISTED_CHAT}
     ORDER BY c.pinned_at DESC NULLS LAST, c.updated_at DESC LIMIT ${CHAT_LIST_LIMIT}`,
    [workspaceId],
  );
  return withChatBranches(db, await withNativeTerminals(db, rows.map(toConversationSummary)));
}

export async function getSummary(db: Queryable, id: string): Promise<ConversationSummary | null> {
  const { rows } = await db.query<ConversationSummaryRow>(`${summaryQuery} WHERE c.id = $1`, [id]);
  return rows[0] ? (await withNativeTerminals(db, [toConversationSummary(rows[0])]))[0]! : null;
}

async function insertConversation(db: Queryable, workspaceId: string, id: string): Promise<void> {
  await db.query(
    `INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, workspaceId, UNTITLED_CONVERSATION],
  );
}

export async function createConversation(
  db: Queryable,
  workspaceId: string,
  id: string,
  options: Omit<CreateConversationRequest, 'id'> = {},
): Promise<ConversationSummary> {
  await insertConversation(db, workspaceId, id);
  if (!(await applyConversationOptions(db, workspaceId, id, options)))
    throw new ConversationNotFoundError(id);
  const summary = await getSummary(db, id);
  if (!summary) throw new ConversationNotFoundError(id);
  return summary;
}

export async function pruneEmptyConversations(db: Queryable, workspaceId: string): Promise<void> {
  await db.query(
    `DELETE FROM conversations c WHERE c.workspace_id = $1
       AND c.updated_at < now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM native_terminal_sessions t WHERE t.conversation_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM outpost_members om WHERE om.conversation_id = c.id)`,
    [workspaceId],
  );
}

export async function getConversationDetail(
  db: Queryable,
  id: string,
): Promise<ConversationDetail | null> {
  const summary = await getSummary(db, id);
  if (!summary) return null;
  const [conversation] = await withChatBranches(db, [summary]);
  if (!conversation) return null;
  const [
    messages,
    runs,
    steps,
    settings,
    tasks,
    approvals,
    advice,
    orchestrations,
    plans,
    compactions,
    continuedIn,
    queue,
    memberMessages,
    railFlags,
    browserShots,
    commands,
    interruption,
    subagents,
    nativeActivity,
    promptCache,
  ] = await Promise.all([
    db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = $1 ORDER BY created_at, id`,
      [id],
    ),
    db.query<RunRow>(
      `SELECT r.*, ${RUN_OUTPOST_COLUMNS} FROM runs r ${RUN_OUTPOST_JOINS}
       WHERE r.conversation_id = $1 ORDER BY r.created_at`,
      [id],
    ),
    db.query<StepEventRow>(
      `SELECT e.run_id, e.type,
         COALESCE(e.payload->>'stepName', e.payload->>'messageId') AS name,
         e.payload ? 'subagentRunId' AS subagent
       FROM run_events e
       JOIN runs r ON r.id = e.run_id
       WHERE r.conversation_id = $1
         AND e.type IN ('STEP_STARTED', 'STEP_FINISHED', 'REASONING_START')
         AND ${STEP_NOT_INTERRUPTED}
       ORDER BY e.run_id, e.seq`,
      [id],
    ),
    resolveChatSettings(db, id),
    taskOverviews(db, id),
    shownApprovalsForConversation(db, id),
    conversationAdvice(db, id),
    conversationOrchestrations(db, id),
    conversationPlans(db, id),
    listCompactions(db, id),
    listContinuations(db, id),
    listQueue(db, id),
    listMemberMessages(db, id),
    listRailFlags(db, id),
    listBrowserShots(db, id),
    listCommands(db, id),
    findInterruption(db, id),
    conversationSubagents(db, id),
    nativeStepActivity(db, id),
    promptCacheFor(db, id),
  ]);
  const attachments = await attachmentsForMessages(
    db,
    messages.rows.map((message) => message.id),
  );
  const allRuns = runs.rows.map(toRun);
  const detailRuns = allRuns.filter((run) => !run.parentRunId);
  return {
    conversation,
    messages: messages.rows.map((message) => toMessage(message, attachments.get(message.id))),
    runs: detailRuns,
    activity: { ...activityFromEvents(steps.rows), ...nativeActivity },
    settings,
    usageTotals: { ...conversationUsage(allRuns), advisors: advice.usage },
    tasks,
    approvals,
    advice: advice.byRun,
    orchestrations,
    plans,
    compactions,
    continuedIn,
    queue,
    memberMessages,
    railFlags,
    ...(browserShots.length > 0 ? { browserShots } : {}),
    ...(commands.length > 0 ? { commands } : {}),
    ...(interruption ? { interruption } : {}),
    ...(Object.keys(subagents).length > 0 ? { subagents } : {}),
    ...(promptCache.last ? { promptCache } : {}),
  };
}

export interface RunTarget {
  provider: string;
  model?: string | null;
  effort?: string | null;
  permission?: string | null;
  agentMode?: string | null;
  level?: InvolvementLevel | null;
  options?: ConfigValues;
  modelSwitch?: ModelSwitch | null;
}

async function runMode(
  db: Queryable,
  conversationId: string,
  permission: string | null,
): Promise<RunMode> {
  const { rows } = await db.query<{ linked: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM conversation_projects WHERE conversation_id = $1) AS linked',
    [conversationId],
  );
  if (!rows[0]?.linked) return 'chat';
  return permission === PERMISSION_DO ? 'do' : 'ask';
}

export type SendMessageInput = Omit<
  SendMessageRequest,
  'attachmentIds' | 'annotations' | 'source'
> & {
  attachmentIds?: readonly string[];
  annotations?: SendMessageRequest['annotations'];
  source?: MessageSource | 'ticket' | 'pr_follow_up' | 'queue' | 'slack' | 'outpost' | undefined;
  startAs?: StartAs;
  continuesRunId?: string;
};

export async function sendUserMessage(
  db: Db,
  conversationId: string,
  request: SendMessageInput,
  target: RunTarget,
  workspaceId?: string,
): Promise<SendMessageResponse> {
  return withTransaction(db, (client) =>
    sendInTransaction(client, conversationId, request, target, workspaceId),
  );
}

export async function sendInTransaction(
  client: Queryable,
  conversationId: string,
  request: SendMessageInput,
  target: RunTarget,
  workspaceId?: string,
): Promise<SendMessageResponse> {
  if (workspaceId) await insertConversation(client, workspaceId, conversationId);
  const conversation = await client.query<{ title: string; session_type: string }>(
    'SELECT title, session_type FROM conversations WHERE id = $1 FOR UPDATE',
    [conversationId],
  );
  const current = conversation.rows[0];
  if (!current) throw new ConversationNotFoundError(conversationId);

  const inserted = await client.query<MessageRow>(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)
     ON CONFLICT (id) DO NOTHING RETURNING ${MESSAGE_COLUMNS}`,
    [request.id, conversationId, request.content],
  );

  if (!inserted.rows[0]) {
    return existingSend(client, conversationId, request);
  }

  const attachments = await linkAttachments(
    client,
    conversationId,
    request.id,
    request.attachmentIds ?? [],
  );
  await insertAnnotations(client, conversationId, request.id, request.annotations ?? []);
  const runId = newId();
  const terminal = current.session_type === 'terminal';
  const task = await taskForNewRun(client, conversationId);
  const mode = await runMode(client, conversationId, target.permission ?? null);
  const device = await deviceStartingRun(client, conversationId, request.id, terminal);
  const run = await client.query<RunRow>(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, effort, status,
       task_id, plan_version, mode, level, agent_mode, config_values,
       picked_mode, start_as, source, continues_run_id, model_switch, remote_device_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10, $11, $12, $9, $13, $14, $15, $16,
       $17)
     RETURNING *`,
    [
      runId,
      conversationId,
      request.id,
      target.provider,
      target.model ?? null,
      target.effort ?? null,
      task?.taskId ?? null,
      task?.planVersion ?? null,
      mode,
      mode === 'do' ? (terminal ? TERMINAL_RUN_LEVEL : (target.level ?? null)) : null,
      target.agentMode ?? null,
      JSON.stringify(target.options ?? {}),
      mode === 'do' ? (request.startAs ?? null) : null,
      request.source ?? null,
      request.continuesRunId ?? null,
      target.modelSwitch ? JSON.stringify(target.modelSwitch) : null,
      device,
    ],
  );
  await continueOpenRequest(client, conversationId, runId);
  if (!terminal) {
    await client.query(`INSERT INTO jobs (id, run_id, status) VALUES ($1, $2, 'queued')`, [
      newId(),
      runId,
    ]);
  }
  const title =
    current.title === UNTITLED_CONVERSATION
      ? titleFromMessage(request.content || attachments.map((file) => file.name).join(', '))
      : current.title;
  await client.query(
    'UPDATE conversations SET title = $2, updated_at = now(), archived_at = NULL WHERE id = $1',
    [conversationId, title],
  );
  if (!terminal) await client.query(`SELECT pg_notify('jobs', $1)`, [runId]);
  return { message: toMessage(inserted.rows[0], attachments), run: toRun(run.rows[0]!) };
}

async function existingSend(
  db: Queryable,
  conversationId: string,
  request: SendMessageInput,
): Promise<SendMessageResponse> {
  const message = await db.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = $1`,
    [request.id],
  );
  const existing = message.rows[0];
  if (
    !existing ||
    existing.role !== 'user' ||
    existing.conversation_id !== conversationId ||
    existing.content !== request.content
  ) {
    throw new MessageConflictError(request.id);
  }
  const attachments = (await attachmentsForMessages(db, [request.id])).get(request.id) ?? [];
  const requested = new Set(request.attachmentIds ?? []);
  if (
    attachments.length !== requested.size ||
    attachments.some((attachment) => !requested.has(attachment.id))
  ) {
    throw new MessageConflictError(request.id);
  }
  const run = await db.query<RunRow>(
    'SELECT * FROM runs WHERE user_message_id = $1 AND parent_run_id IS NULL',
    [request.id],
  );
  const sent = run.rows[0];
  if (!sent) throw new MessageConflictError(request.id);
  return { message: toMessage(existing, attachments), run: toRun(sent) };
}
