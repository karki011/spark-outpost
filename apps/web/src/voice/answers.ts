import type { InboxTicket, TicketSection } from '@spark-outpost/contracts';
import {
  fastAnswer,
  type FastAnswer,
  type FastChat,
  type FastState,
} from '../island/ask-fast-path.ts';
import type { FastQuestion, TicketRef } from './commands.ts';

export interface InstantAnswer {
  text: string;
  chats: FastChat[];
}

const SECTION_WORDS: Record<TicketSection, string> = {
  attention: 'need you',
  spark: 'Spark is working on',
  started: 'started',
  up_next: 'up next',
  review: 'in review',
  done: 'done',
};

const PENDING: readonly TicketSection[] = ['attention', 'spark', 'started', 'up_next', 'review'];

const CANONICAL: Record<'needs' | 'running' | 'spend', string> = {
  needs: 'who needs me',
  running: 'what is running',
  spend: 'what did I spend today',
};

function fromFast(answer: FastAnswer | null, fallback: string): InstantAnswer {
  return answer ? { text: answer.text, chats: answer.chats } : { text: fallback, chats: [] };
}

export function chatAnswer(
  question: 'needs' | 'running' | 'spend',
  state: FastState,
): InstantAnswer {
  return fromFast(fastAnswer(CANONICAL[question], state), 'Spark has no spend for today yet.');
}

export function ticketsAnswer(tickets: readonly InboxTicket[] | null): InstantAnswer {
  if (tickets === null) return { text: 'No ticket source is connected.', chats: [] };
  const pending = tickets.filter((ticket) => PENDING.includes(ticket.section));
  if (pending.length === 0) return { text: 'You have no pending tickets.', chats: [] };
  const counts = PENDING.map((section) => ({
    section,
    count: pending.filter((ticket) => ticket.section === section).length,
  })).filter((entry) => entry.count > 0);
  const parts = counts.map((entry) => `${entry.count} ${SECTION_WORDS[entry.section]}`);
  const top = [...pending]
    .sort((left, right) => PENDING.indexOf(left.section) - PENDING.indexOf(right.section))
    .slice(0, 3)
    .map((ticket) => `${ticket.key} ${ticket.title}`);
  const total = `${pending.length} pending ${pending.length === 1 ? 'ticket' : 'tickets'}`;
  return { text: `You have ${total}: ${parts.join(', ')}. Top: ${top.join('; ')}.`, chats: [] };
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

export function questionText(question: FastQuestion, ticket: TicketRef | null): string {
  switch (question) {
    case 'needs':
      return 'Who needs me?';
    case 'running':
      return 'What’s running?';
    case 'spend':
      return 'What did I spend today?';
    case 'tickets':
      return 'What tickets do I have pending?';
    case 'ticket_status':
      return `What’s the status of ${ticket?.key ?? 'that ticket'}?`;
  }
}
