import type { InboxTicket } from '@spark-outpost/contracts';
import type { TicketRef } from './commands.ts';

export interface AnswerChat {
  id: string;
  title: string;
  detail: string;
}

export interface InstantAnswer {
  text: string;
  chats: AnswerChat[];
}

export function ticketStatusAnswer(ticket: InboxTicket): InstantAnswer {
  const parts = [`${ticket.key} ${ticket.title} is ${ticket.statusName}.`];
  if (ticket.chat) parts.push(`Its chat “${ticket.chat.title}” is ${ticket.chat.state}.`);
  if (ticket.pullRequest) parts.push(`Its pull request is ${ticket.pullRequest.state}.`);
  const chats = ticket.chat
    ? [{ id: ticket.chat.conversationId, title: ticket.chat.title, detail: ticket.chat.state }]
    : [];
  return { text: parts.join(' '), chats };
}

export function lookedUpAnswer(ref: TicketRef, title: string, statusName: string): InstantAnswer {
  return { text: `${ref.key} ${title} is ${statusName}.`, chats: [] };
}
