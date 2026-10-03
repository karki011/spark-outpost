import {
  sparkWorkingText,
  ticketChatState,
  ticketSectionSchema,
  type ConversationAttention,
  type ConversationSummary,
  type InboxTicket,
  type TicketSection,
} from '@spark-outpost/contracts';
import type { RowTone } from './TicketRow.tsx';
import { ticketId } from './ticket-model.ts';

export type ChipTone = 'needs' | 'bad' | 'spark' | 'started' | 'next' | 'review' | 'done';

export interface FlowChip {
  label: string;
  tone: ChipTone;
}

const CHIPS: Record<TicketSection, FlowChip> = {
  attention: { label: 'Needs you', tone: 'needs' },
  spark: { label: 'With Spark', tone: 'spark' },
  started: { label: 'Started', tone: 'started' },
  up_next: { label: 'Up next', tone: 'next' },
  review: { label: 'In review', tone: 'review' },
  done: { label: 'Done', tone: 'done' },
};

export function flowChip(section: TicketSection, tone: RowTone): FlowChip {
  return section === 'attention' && tone === 'error'
    ? { ...CHIPS.attention, tone: 'bad' }
    : CHIPS[section];
}

export type ChatLookup = ReadonlyMap<string, ConversationSummary>;

export function chatLookup(chats: readonly ConversationSummary[]): ChatLookup {
  return new Map(chats.map((chat) => [chat.id, chat] as const));
}

export function liveChatOf(ticket: InboxTicket, chats: ChatLookup): ConversationSummary | null {
  return ticket.chat ? (chats.get(ticket.chat.conversationId) ?? null) : null;
}

const CHAT_RULES = new Set(['chat-asking', 'chat-error']);

function settledSection(ticket: InboxTicket): TicketSection {
  const pull = ticket.pullRequest;
  if (pull?.state === 'merged') return 'done';
  const linked = ticket.work.some((work) => work.pullRequests.length > 0);
  if ((pull && pull.state !== 'closed') || (!pull && linked) || ticket.status === 'in_review') {
    return 'review';
  }
  return 'started';
}

export function liveSection(ticket: InboxTicket, chat: ConversationSummary | null): TicketSection {
  if (!chat || !ticket.chat || ticket.section === 'done') return ticket.section;
  const live = ticketChatState(chat);
  if (live === ticket.chat.state) return ticket.section;
  if (live === 'asking' || live === 'error') return 'attention';
  const flaggedByChatOnly = ticket.flags.every((flag) => CHAT_RULES.has(flag.rule));
  if (ticket.section === 'attention' && !flaggedByChatOnly) return 'attention';
  if (live === 'running') return 'spark';
  if (ticket.section === 'attention' || ticket.section === 'spark') return settledSection(ticket);
  return ticket.section;
}

export function askingText(attention: ConversationAttention | null): string {
  switch (attention?.kind) {
    case 'plan':
      return 'Approve plan';
    case 'permission':
      return attention.prFeedback ? 'Confirm PR fixes' : 'Allow a step';
    case 'review':
      return 'Review changes';
    case 'input':
      return 'Answer a question';
    case 'stuck':
      return 'Check a stuck chat';
    case 'flag':
      return 'Check a flagged action';
    default:
      return 'Waiting for your answer';
  }
}

export interface LiveTicket {
  ticket: InboxTicket;
  section: TicketSection;
  line: string;
  tone: RowTone;
  chat: ConversationSummary | null;
}

export function liveTicket(ticket: InboxTicket, chats: ChatLookup): LiveTicket {
  const chat = liveChatOf(ticket, chats);
  const section = liveSection(ticket, chat);
  const state = chat ? ticketChatState(chat) : null;
  const leadIsChat = !ticket.flags[0] || CHAT_RULES.has(ticket.flags[0].rule);
  if (state === 'asking' && leadIsChat) {
    return { ticket, section, line: askingText(chat!.attention), tone: 'warn', chat };
  }
  if (state === 'error' && leadIsChat) {
    return { ticket, section, line: 'Chat stopped with an error', tone: 'error', chat };
  }
  if (state === 'running' && section === 'spark') {
    const progress = chat!.latestRun?.progress ?? null;
    const line = sparkWorkingText(progress, chat!.teammate?.name ?? null);
    return { ticket, section, line, tone: 'running', chat };
  }
  return { ticket, section, line: ticket.reason, tone: ticket.tone, chat };
}

export function liveTickets(
  tickets: readonly InboxTicket[],
  chats: ChatLookup,
): readonly LiveTicket[] {
  const live = tickets.map((ticket) => liveTicket(ticket, chats));
  return ticketSectionSchema.options.flatMap((section) =>
    live.filter((entry) => entry.section === section),
  );
}

export function staleChats(tickets: readonly InboxTicket[], chats: ChatLookup): string {
  return tickets
    .flatMap((ticket) => {
      const chat = liveChatOf(ticket, chats);
      if (!chat || !ticket.chat) return [];
      const live = ticketChatState(chat);
      return live === ticket.chat.state ? [] : [`${ticketId(ticket)}=${live}`];
    })
    .join(' ');
}
