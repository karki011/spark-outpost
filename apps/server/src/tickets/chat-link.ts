import type { ChatTickets, LinkChatTicketRequest, RunChanges } from '@spark-outpost/contracts';
import {
  chatTickets,
  chatTicketStates,
  dismissChatSuggestions,
  linkedChatTicketKeys,
  saveChatTicket,
  type ChatTicketState,
} from '../persistence/chat-tickets.ts';
import { ConversationNotFoundError } from '../persistence/conversations.ts';
import type { Queryable } from '../persistence/db.ts';
import { cacheTickets, ticketRef, type CachedTicket } from '../persistence/tickets.ts';
import { requireSource, type TicketDeps } from './connections.ts';
import { knownMentions, type KnownMention } from './mention-cache.ts';
import { branchTitleWithKeys, mentionIntent } from './mentions.ts';

export interface BuildTurn {
  workspaceId: string;
  conversationId: string;
  request: string;
  builds: boolean;
}

const refOf = (ticket: { source: CachedTicket['source']; key: string }) =>
  ticketRef(ticket.source, ticket.key);

function buildTarget(request: string, known: readonly KnownMention[]): CachedTicket | null {
  if (known.length !== 1) return null;
  const only = known[0]!;
  return mentionIntent(request, only.mention) === 'target' ? only.ticket : null;
}

export async function linkTicketForBuild(db: Queryable, turn: BuildTurn): Promise<void> {
  const known = await knownMentions(db, turn.workspaceId, turn.request);
  if (known.length === 0) return;
  const { conversationId, workspaceId } = turn;
  const states = await chatTicketStates(db, conversationId);
  if ([...states.values()].includes('linked')) return;
  const target = turn.builds ? buildTarget(turn.request, known) : null;
  const stateOf = (ticket: CachedTicket): ChatTicketState | undefined => states.get(refOf(ticket));
  if (target && (stateOf(target) === undefined || stateOf(target) === 'suggested')) {
    await saveChatTicket(db, workspaceId, conversationId, target, 'linked', 'message');
    return;
  }
  for (const { ticket } of known) {
    if (stateOf(ticket) !== undefined) continue;
    await saveChatTicket(db, workspaceId, conversationId, ticket, 'suggested', 'message');
  }
}

export type ChangedTurn = Omit<BuildTurn, 'builds'>;

export function linkTicketForChanges(
  db: Queryable,
  turn: ChangedTurn,
  changes: Pick<RunChanges, 'files'>,
): Promise<void> {
  return linkTicketForBuild(db, { ...turn, builds: changes.files.length > 0 });
}

export async function ticketBranchTitle(
  db: Queryable,
  conversationId: string,
  title: string,
): Promise<string> {
  const workspaceId = await conversationWorkspace(db, conversationId);
  if (!workspaceId) return title;
  const linked = await linkedChatTicketKeys(db, conversationId);
  const known = await knownMentions(db, workspaceId, title);
  const drop = known.map((entry) => entry.ticket.key).filter((key) => !linked.includes(key));
  return branchTitleWithKeys(title, linked, drop);
}

async function conversationWorkspace(db: Queryable, conversationId: string) {
  const { rows } = await db.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM conversations WHERE id = $1',
    [conversationId],
  );
  return rows[0]?.workspace_id ?? null;
}

async function mentionedTickets(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  shown: ReadonlySet<string>,
): Promise<CachedTicket[]> {
  const { rows } = await db.query<{ content: string; source: string | null }>(
    `SELECT m.content, r.source FROM messages m
     LEFT JOIN runs r ON r.user_message_id = m.id
     WHERE m.conversation_id = $1 AND m.role = 'user'
     ORDER BY m.created_at DESC LIMIT 1`,
    [conversationId],
  );
  const latest = rows[0];
  if (!latest || latest.source === 'ticket') return [];
  const known = await knownMentions(db, workspaceId, latest.content);
  return known.map((entry) => entry.ticket).filter((ticket) => !shown.has(refOf(ticket)));
}

export async function chatTicketView(db: Queryable, conversationId: string): Promise<ChatTickets> {
  const workspaceId = await conversationWorkspace(db, conversationId);
  if (!workspaceId) return { linked: [], suggested: [], mentioned: [] };
  const view = await chatTickets(db, conversationId);
  const shown = new Set([...view.linked, ...view.suggested].map(refOf));
  const mentioned = await mentionedTickets(db, workspaceId, conversationId, shown);
  return { ...view, mentioned };
}

async function requireConversation(deps: TicketDeps, conversationId: string): Promise<void> {
  const workspaceId = await conversationWorkspace(deps.db, conversationId);
  if (workspaceId !== deps.workspaceId) throw new ConversationNotFoundError(conversationId);
}

export async function linkChatTicket(
  deps: TicketDeps,
  conversationId: string,
  request: LinkChatTicketRequest,
): Promise<ChatTickets> {
  await requireConversation(deps, conversationId);
  const open = await requireSource(deps, request.source);
  const ticket = await open.source.getSummary(request.key.toUpperCase());
  await cacheTickets(deps.db, deps.workspaceId, [ticket]);
  await saveChatTicket(deps.db, deps.workspaceId, conversationId, ticket, 'linked', 'user');
  return chatTicketView(deps.db, conversationId);
}

export async function unlinkChatTicket(
  deps: TicketDeps,
  conversationId: string,
  request: LinkChatTicketRequest,
): Promise<ChatTickets> {
  await requireConversation(deps, conversationId);
  const ticket = { source: request.source, key: request.key.toUpperCase() };
  const states = await chatTicketStates(deps.db, conversationId);
  if (states.has(refOf(ticket))) {
    await saveChatTicket(deps.db, deps.workspaceId, conversationId, ticket, 'unlinked', 'user');
  }
  return chatTicketView(deps.db, conversationId);
}

export async function dismissChatTicketSuggestions(
  deps: TicketDeps,
  conversationId: string,
): Promise<ChatTickets> {
  await requireConversation(deps, conversationId);
  await dismissChatSuggestions(deps.db, conversationId);
  return chatTicketView(deps.db, conversationId);
}
