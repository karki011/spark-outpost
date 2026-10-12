import {
  NEEDS_YOU_PREFIX,
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
import { containsPattern } from './like-pattern.ts';
import { taskForNewRun } from './tasks.ts';
import { listQueue } from './chat-queue.ts';
import { listMemberMessages } from './member-messages.ts';
import { taskOverviews } from './task-views.ts';
import { conversationUsage } from './usage.ts';
import { findInterruption } from './interruptions.ts';
import { withNativeTerminals } from './native-terminals.ts';
import { applyConversationOptions } from './conversation-options.ts';
import { continueOpenRequest } from '../outposts/continuation.ts';
import {
  RUN_OUTPOST_COLUMNS,
  RUN_OUTPOST_JOINS,
  toConversationSummary,
  toMessage,
  toRun,
  type ConversationSummaryRow,
  type MessageRow,
  type RunRow,
} from './rows.ts';
import { workReply } from './work-reply.ts';

const LOCAL_WORKSPACE_SLUG = 'local';
const TERMINAL_RUN_LEVEL: InvolvementLevel = 'hands-off';

const summaryQuery = `
  SELECT c.id, c.title, c.updated_at, c.archived_at, c.pinned_at, c.pinned_order, c.title_source,
    tm.id AS teammate_id, tm.name AS teammate_name, tm.role AS teammate_role,
    tm.face_shape AS teammate_shape, tm.face_color AS teammate_color,
    COALESCE(
      (SELECT cr.category FROM runs cr
       WHERE cr.conversation_id = c.id AND cr.parent_run_id IS NULL
         AND cr.category IS NOT NULL AND cr.category <> 'question'
       ORDER BY cr.created_at DESC LIMIT 1),
      (SELECT cr.category FROM runs cr
       WHERE cr.conversation_id = c.id AND cr.parent_run_id IS NULL AND cr.category = 'question'
       LIMIT 1)
    ) AS category,
    r.id AS latest_run_id, r.status AS latest_run_status, r.error AS latest_run_error,
    r.provider AS latest_run_provider, r.interruption_choice AS latest_run_interruption_choice,
    CASE WHEN r.status IN ('queued', 'running') THEN (
      SELECT jsonb_build_object(
        'done', count(*) FILTER (WHERE entry->>'status' = 'completed'),
        'active', count(*) FILTER (WHERE entry->>'status' = 'in_progress'),
        'total', count(*))
      FROM (
        SELECT body FROM run_artifacts
        WHERE task_id = r.task_id AND kind = 'plan' ORDER BY version DESC LIMIT 1
      ) plan, jsonb_array_elements(plan.body->'entries') entry
      WHERE btrim(entry->>'content') <> ''
    ) END AS latest_run_progress,
    CASE WHEN r.status = 'running' THEN (
      SELECT e.payload->>'stepName' FROM run_events e
      WHERE e.run_id = r.id AND e.type = 'STEP_STARTED' ORDER BY e.seq DESC LIMIT 1
    ) END AS latest_run_step,
    CASE WHEN r.status = 'running' THEN (
      SELECT (e.payload->'content'->>'waitingOn')::int FROM run_events e
      WHERE e.run_id = r.id AND e.type = 'ACTIVITY_SNAPSHOT'
        AND e.payload->>'activityType' = 'subagents'
      ORDER BY e.seq DESC LIMIT 1
    ) END AS latest_run_waiting_on,
    CASE WHEN r.status = 'succeeded' THEN (
      SELECT CASE WHEN strpos(work.text, '${NEEDS_YOU_PREFIX}') > 0 THEN work.text END
      FROM (${workReply('r.id', 'm.content')}) work
    ) END AS latest_run_asking_reply,
    COALESCE(
      r.status = 'succeeded' AND r.finished_at > COALESCE(c.last_read_at, '-infinity'::timestamptz),
      false
    ) AS unread,
    COALESCE(
      r.status = 'awaiting_approval' OR p.pending_id IS NOT NULL OR fl.flag_id IS NOT NULL, false
    ) AS needs_input,
    fl.flag_title,
    COALESCE((
      SELECT bool_or(w.pr_state = 'merged') AND NOT bool_or(w.pr_state = 'open')
      FROM pr_watches w WHERE w.conversation_id = c.id
    ), false) AS pull_request_merged,
    p.pending_id, p.pending_kind, p.pending_title, p.pending_command, p.pending_paths,
    p.pending_agent, p.pending_member, p.pending_asker, p.pending_questions, p.pending_plan,
    p.pending_provider, p.pending_pr_feedback,
    om.outpost_id, ob.name AS outpost_name, om.handle AS outpost_handle,
    ARRAY(
      SELECT cp.project_id::text FROM conversation_projects cp
      WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at
    ) AS project_ids,
    (SELECT cp.sort_order FROM conversation_projects cp
     WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at LIMIT 1) AS project_order
  FROM conversations c
  LEFT JOIN teammates tm ON tm.id = c.teammate_id
  LEFT JOIN outpost_members om ON om.conversation_id = c.id
  LEFT JOIN outposts ob ON ob.id = om.outpost_id
  LEFT JOIN LATERAL (
    SELECT id, status, error, finished_at, provider, task_id, interruption_choice FROM runs
    WHERE conversation_id = c.id AND parent_run_id IS NULL ORDER BY created_at DESC LIMIT 1
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT a.id AS pending_id, a.kind AS pending_kind, a.title AS pending_title,
      a.payload->>'command' AS pending_command, a.payload->'paths' AS pending_paths,
      CASE WHEN ar.parent_run_id IS NOT NULL THEN ar.route->>'name' END AS pending_agent,
      m.name AS pending_member, a.payload->'checkpoint'->>'agent' AS pending_asker,
      a.payload->'checkpoint'->'questions'->0 IS NOT NULL AS pending_questions,
      a.payload->>'plan' IS NOT NULL AS pending_plan,
      COALESCE(m.provider, ar.provider) AS pending_provider,
      a.payload->'sparkAction'->>'action' = 'pr_follow_up' AS pending_pr_feedback
    FROM approvals a
    JOIN runs ar ON ar.id = a.run_id
    LEFT JOIN LATERAL (
      SELECT mr.route->>'name' AS name, mr.provider FROM runs mr
      WHERE mr.parent_run_id = r.id AND mr.route->>'name' IS NOT NULL
        AND mr.role = CASE a.kind WHEN 'plan' THEN 'architect' WHEN 'accept' THEN 'builder' END
      ORDER BY mr.created_at DESC LIMIT 1
    ) m ON true
    WHERE a.status = 'pending' AND (ar.id = r.id OR ar.parent_run_id = r.id)
    ORDER BY a.created_at, a.id LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT f.id AS flag_id, f.title AS flag_title FROM rail_flags f
    WHERE f.conversation_id = c.id AND f.status = 'open'
    ORDER BY f.created_at DESC LIMIT 1
  ) fl ON true`;

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
  const { rows } = await db.query<ConversationSummaryRow>(
    `${summaryQuery} WHERE c.workspace_id = $1 AND c.kind = 'chat'
       AND (EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
         OR EXISTS (SELECT 1 FROM native_terminal_sessions t WHERE t.conversation_id = c.id)
         OR om.outpost_id IS NOT NULL)
       AND ($2 = '' OR c.title ILIKE $3 OR EXISTS (
         SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE $3
       ))
     ORDER BY c.pinned_at DESC NULLS LAST, c.updated_at DESC LIMIT 500`,
    [workspaceId, text, containsPattern(text)],
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
  ] = await Promise.all([
    db.query<MessageRow>(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at, id',
      [id],
    ),
    db.query<RunRow>(
      `SELECT r.*, ${RUN_OUTPOST_COLUMNS} FROM runs r ${RUN_OUTPOST_JOINS}
       WHERE r.conversation_id = $1 ORDER BY r.created_at`,
      [id],
    ),
    db.query<StepEventRow>(
      `SELECT e.run_id, e.type,
         COALESCE(e.payload->>'stepName', e.payload->>'messageId') AS name
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
    activity: activityFromEvents(steps.rows),
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
     ON CONFLICT (id) DO NOTHING RETURNING *`,
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
  const run = await client.query<RunRow>(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, effort, status,
       task_id, plan_version, mode, level, agent_mode, config_values,
       picked_mode, start_as, source, continues_run_id, model_switch)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10, $11, $12, $9, $13, $14, $15, $16)
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
  const message = await db.query<MessageRow>('SELECT * FROM messages WHERE id = $1', [request.id]);
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
