import type {
  StartTicketRequest,
  StartTicketResponse,
  TicketDetail,
  TicketSourceId,
} from '@spark-outpost/contracts';
import { setConversationProjects } from '../persistence/conversation-projects.ts';
import {
  createConversation,
  sendUserMessage,
  type RunTarget,
} from '../persistence/conversations.ts';
import { withTransaction, type Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import { cacheTickets, linkTaskTicket, openTicketTask } from '../persistence/tickets.ts';
import { addTaskLink, taskTitle } from '../persistence/tasks.ts';
import { requireSource, type TicketDeps } from './connections.ts';
import { ticketRequest } from './request.ts';
import { summaryOf, TicketConflictError } from './source.ts';
import { moveTicket } from './sync.ts';

export interface StartDeps extends TicketDeps {
  runTarget(conversationId: string): Promise<RunTarget>;
}

async function hasMessages(db: Queryable, conversationId: string): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM messages WHERE conversation_id = $1) AS found',
    [conversationId],
  );
  return rows[0]?.found === true;
}

async function prepareTask(
  deps: StartDeps,
  ticket: TicketDetail,
  request: StartTicketRequest,
): Promise<string> {
  return withTransaction(deps.db, async (client) => {
    const { conversationId } = request;
    await createConversation(client, deps.workspaceId, conversationId);
    const existing = await openTicketTask(client, conversationId, ticket);
    if (existing) return existing;
    if (await hasMessages(client, conversationId)) {
      throw new TicketConflictError('Start work on a ticket in a new chat.');
    }
    if (request.projectId) {
      await setConversationProjects(client, deps.workspaceId, conversationId, [request.projectId]);
    }
    const taskId = newId();
    await client.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      conversationId,
      taskTitle(`${ticket.key}: ${ticket.title}`),
    ]);
    await cacheTickets(client, deps.workspaceId, [summaryOf(ticket)]);
    await linkTaskTicket(client, deps.workspaceId, taskId, ticket);
    await addTaskLink(client, taskId, {
      kind: 'link',
      url: ticket.url,
      title: `${ticket.key}: ${ticket.title}`,
      source: 'ticket',
    });
    return taskId;
  });
}

export async function startTicket(
  deps: StartDeps,
  source: TicketSourceId,
  key: string,
  request: StartTicketRequest,
): Promise<StartTicketResponse> {
  const open = await requireSource(deps, source);
  const ticket = await open.source.getTicket(key);
  const taskId = await prepareTask(deps, ticket, request);
  const target = await deps.runTarget(request.conversationId);
  const sent = await sendUserMessage(
    deps.db,
    request.conversationId,
    { id: request.messageId, content: ticketRequest(ticket, request.mode), source: 'ticket' },
    target,
    deps.workspaceId,
  );
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source,
    action: 'start',
    ticketKey: ticket.key,
    taskId,
    outcome: 'succeeded',
    detail: { mode: request.mode, conversationId: request.conversationId, runId: sent.run.id },
  });
  const transition = request.moveToInProgress
    ? await moveTicket(deps, open, ticket.key, 'in_progress', taskId)
    : null;
  return {
    conversationId: request.conversationId,
    taskId,
    runId: sent.run.id,
    ticket: summaryOf(ticket),
    transition,
  };
}
