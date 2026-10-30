import { ANSWERED_BY_ASK_SPARK, type AskSparkAction } from '@spark-outpost/contracts';
import { sparkToolsOffered } from '../../agents/acp/spark-tools.ts';
import { decideApproval } from '../../persistence/approvals.ts';
import { addToQueue, alreadySent, takeQueued } from '../../persistence/chat-queue.ts';
import { createConversation } from '../../persistence/conversations.ts';
import type { Db } from '../../persistence/db.ts';
import { newId } from '../../persistence/ids.ts';
import { startTicket } from '../../tickets/start.ts';
import { archiveChat } from '../../workflow/archive-chat.ts';
import { chatTarget, drainQueue, type DrainOutcome } from '../../workflow/queue-drain.ts';
import { changeSparkPause } from '../../workflow/spark-pause-change.ts';
import { stopRun } from '../../workflow/stop-run.ts';
import { ticketDepsFor } from '../deps.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import { performInbox } from './ask-spark-inbox.ts';
import { ASK_SPARK_REFUSALS, cardRefusalFor } from './ask-spark-limits.ts';
import { performMeeting } from './ask-spark-meetings.ts';
import type { Performed } from './performed.ts';

interface ChatFacts {
  title: string;
  terminal: boolean;
  archived: boolean;
}

export async function chatFacts(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<ChatFacts> {
  const { rows } = await db.query<{
    title: string;
    session_type: string | null;
    archived: boolean;
  }>(
    `SELECT title, session_type, archived_at IS NOT NULL AS archived FROM conversations
     WHERE id = $1 AND workspace_id = $2`,
    [conversationId, workspaceId],
  );
  const row = rows[0];
  if (!row) throw new SparkToolError('That chat no longer exists.');
  return { title: row.title, terminal: row.session_type === 'terminal', archived: row.archived };
}

type Delivery = 'sent' | 'behind' | 'stopped' | 'held' | 'archived';

const DELIVERED: Record<DrainOutcome, Delivery> = {
  sent: 'behind',
  busy: 'behind',
  paused: 'stopped',
  held: 'held',
  archived: 'archived',
  empty: 'behind',
};

async function sendAsAssistant(db: Db, conversationId: string, content: string): Promise<Delivery> {
  const id = newId();
  await addToQueue(db, conversationId, { id, content, origin: 'assistant' });
  let outcome: DrainOutcome;
  try {
    outcome = await drainQueue(db, conversationId, chatTarget(db));
  } catch (error) {
    await takeQueued(db, conversationId, id);
    throw error;
  }
  return (await alreadySent(db, id)) ? 'sent' : DELIVERED[outcome];
}

function deliveryLine(delivery: Delivery, title: string): string {
  switch (delivery) {
    case 'sent':
      return `Sent the message to “${title}”.`;
    case 'behind':
      return `Queued the message for “${title}” behind the running turn.`;
    case 'stopped':
      return `Queued the message for “${title}”. Waiting: the last turn stopped.`;
    case 'held':
      return `Queued the message for “${title}”. Held while Spark is paused.`;
    case 'archived':
      return `Queued the message for “${title}”. Held while the chat is archived.`;
  }
}

async function activeRun(db: Db, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
       AND status IN ('queued', 'running', 'awaiting_approval')
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0]?.id ?? null;
}

async function dropEmptyChat(db: Db, conversationId: string): Promise<void> {
  await db.query(
    `DELETE FROM conversations c WHERE c.id = $1
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)`,
    [conversationId],
  );
}

async function projectName(db: Db, projectId: string): Promise<string | null> {
  const { rows } = await db.query<{ name: string }>('SELECT name FROM projects WHERE id = $1', [
    projectId,
  ]);
  return rows[0]?.name ?? null;
}

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new SparkToolError(`This action is missing its ${what}.`);
  return value;
}

async function startChat(context: SparkToolContext, action: AskSparkAction): Promise<Performed> {
  const { deps, scope } = context;
  const id = newId();
  const summary = await createConversation(deps.db, scope.workspaceId, id, {
    projectIds: action.projectId ? [action.projectId] : [],
  });
  await sendAsAssistant(deps.db, id, required(action.text, 'task')).catch(async (error) => {
    await dropEmptyChat(deps.db, id);
    throw error;
  });
  const project = action.projectId ? await projectName(deps.db, action.projectId) : null;
  return {
    message: project ? `Started a new chat in ${project}.` : 'Started a new chat.',
    url: null,
    output: { conversationId: id, title: summary.title },
  };
}

async function sendMessage(context: SparkToolContext, action: AskSparkAction): Promise<Performed> {
  const { deps, scope } = context;
  const chatId = required(action.conversationId, 'chat');
  const chat = await chatFacts(deps.db, scope.workspaceId, chatId);
  if (chat.archived) throw new SparkToolError(ASK_SPARK_REFUSALS.archived);
  const delivery = await sendAsAssistant(deps.db, chatId, required(action.text, 'message'));
  return {
    message: deliveryLine(delivery, chat.title),
    url: null,
    output: { conversationId: chatId },
  };
}

async function stopTurn(context: SparkToolContext, action: AskSparkAction): Promise<Performed> {
  const { deps, scope } = context;
  const chatId = required(action.conversationId, 'chat');
  const chat = await chatFacts(deps.db, scope.workspaceId, chatId);
  const runId = await activeRun(deps.db, chatId);
  if (!runId) return { message: `Nothing was running in “${chat.title}”.`, url: null };
  await stopRun(deps.db, runId);
  return {
    message: `Stopped “${chat.title}”.`,
    url: null,
    output: { conversationId: chatId, runId },
  };
}

async function archive(context: SparkToolContext, action: AskSparkAction): Promise<Performed> {
  const { deps, scope } = context;
  const chatId = required(action.conversationId, 'chat');
  const chat = await chatFacts(deps.db, scope.workspaceId, chatId);
  await archiveChat(deps.db, scope.workspaceId, chatId);
  return { message: `Archived “${chat.title}”.`, url: null, output: { conversationId: chatId } };
}

async function answerCard(context: SparkToolContext, action: AskSparkAction): Promise<Performed> {
  const { deps, scope } = context;
  const approvalId = required(action.approvalId, 'card');
  const { approval, refusal } = await cardRefusalFor(deps.db, scope.workspaceId, approvalId);
  if (refusal || !approval) throw new SparkToolError(refusal ?? 'That card is gone.');
  const kind = action.answer === 'allow_once' ? 'allow_once' : 'reject_once';
  const option = approval.options.find((entry) => entry.kind === kind);
  if (!option) throw new SparkToolError('This card has no such answer.');
  await decideApproval(deps.db, scope.workspaceId, approvalId, {
    optionId: option.optionId,
    scope: 'once',
    payloadHash: approval.payloadHash,
    note: ANSWERED_BY_ASK_SPARK,
  });
  const verb = kind === 'allow_once' ? 'Allowed once' : 'Denied';
  return { message: `${verb}: ${approval.title}.`, url: null, output: { approvalId } };
}

async function pause(context: SparkToolContext, paused: boolean): Promise<Performed> {
  const { deps, scope } = context;
  await changeSparkPause(deps.db, scope.workspaceId, paused, chatTarget(deps.db));
  return { message: paused ? 'Paused Spark.' : 'Resumed Spark.', url: null };
}

async function startTicketWork(
  context: SparkToolContext,
  action: AskSparkAction,
): Promise<Performed> {
  const { deps, scope } = context;
  const ticket = required(action.ticket, 'ticket');
  const conversationId = newId();
  const target = chatTarget(deps.db);
  const started = startTicket(
    {
      ...ticketDepsFor(deps, scope),
      runTarget: target,
      offersSparkTools: (provider) => sparkToolsOffered(deps.agentRuntime ?? 'fake', provider),
      sentByAssistant: true,
    },
    ticket.source,
    ticket.key,
    {
      conversationId,
      messageId: newId(),
      ...(action.projectId ? { projectId: action.projectId } : {}),
      mode: 'build',
      moveToInProgress: true,
      note: '',
      links: [],
      attachmentIds: [],
      folders: [],
    },
  );
  await started.catch(async (error: unknown) => {
    await dropEmptyChat(deps.db, conversationId);
    throw error;
  });
  return {
    message: `Started work on ${ticket.key} in a new chat.`,
    url: null,
    output: { conversationId },
  };
}

export function performAskSpark(
  context: SparkToolContext,
  action: AskSparkAction,
): Promise<Performed> {
  switch (action.op) {
    case 'start_chat':
      return startChat(context, action);
    case 'send_message':
      return sendMessage(context, action);
    case 'stop_turn':
      return stopTurn(context, action);
    case 'archive_chat':
      return archive(context, action);
    case 'answer_card':
      return answerCard(context, action);
    case 'pause_spark':
      return pause(context, true);
    case 'resume_spark':
      return pause(context, false);
    case 'start_ticket':
      return startTicketWork(context, action);
    case 'post_outpost':
    case 'clear_finished':
    case 'set_aside':
      return performInbox(context, action);
    case 'snooze_meeting':
    case 'dismiss_meeting':
    case 'join_meeting':
      return performMeeting(context, action.op, action);
  }
}
