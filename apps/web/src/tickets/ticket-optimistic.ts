import type { InboxTicket, TicketInbox } from '@spark-outpost/contracts';

const QUIET_REASON: Record<InboxTicket['section'], string> = {
  attention: 'Not started',
  spark: 'Working',
  started: 'Chat idle',
  up_next: 'Not started',
  review: 'In review',
  done: 'Done',
};

function quietSection(ticket: InboxTicket): InboxTicket['section'] {
  if (ticket.status === 'done') return 'done';
  if (ticket.chat?.state === 'running') return 'spark';
  if (ticket.status === 'in_review' || ticket.pullRequest) return 'review';
  if (ticket.status === 'in_progress' || ticket.chat) return 'started';
  return 'up_next';
}

export function withoutAttention(ticket: InboxTicket): InboxTicket {
  const section = quietSection(ticket);
  return { ...ticket, section, flags: [], reason: QUIET_REASON[section], tone: 'none' };
}

export function snoozedTicket(ticket: InboxTicket, until: Date): InboxTicket {
  return {
    ...withoutAttention(ticket),
    reason: 'Snoozed',
    snooze: { until: until.toISOString(), rules: ticket.flags.map((flag) => flag.rule) },
  };
}

export function wokenTicket(ticket: InboxTicket): InboxTicket {
  const awake = { ...ticket };
  delete awake.snooze;
  return awake;
}

const sameTicket = (a: InboxTicket, b: InboxTicket) => a.source === b.source && a.key === b.key;

export function findTicket(inbox: TicketInbox, like: InboxTicket): InboxTicket | undefined {
  return inbox.tickets.find((entry) => sameTicket(entry, like));
}

export function replaceTicket(inbox: TicketInbox, next: InboxTicket): TicketInbox {
  return {
    ...inbox,
    tickets: inbox.tickets.map((entry) => (sameTicket(entry, next) ? next : entry)),
  };
}

export function attentionCount(inbox: TicketInbox | undefined): number {
  return (inbox?.tickets ?? []).filter((ticket) => ticket.section === 'attention').length;
}
