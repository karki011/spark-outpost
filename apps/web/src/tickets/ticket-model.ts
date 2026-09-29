import type {
  InboxTicket,
  TicketAge,
  TicketSearchResult,
  TicketSection,
  TicketSourceId,
} from '@spark-outpost/contracts';

export interface SectionMeta {
  id: TicketSection;
  label: string;
  rule: string;
}

export const SECTIONS: readonly SectionMeta[] = [
  { id: 'attention', label: 'Needs attention', rule: 'Flagged by rules; each row says why.' },
  {
    id: 'working',
    label: 'Working on',
    rule: 'A linked chat is running or finished, or the ticket is In progress.',
  },
  {
    id: 'pr_ready',
    label: 'PR ready',
    rule: 'A draft pull request from Ship is waiting for your next move.',
  },
  {
    id: 'in_review',
    label: 'In review',
    rule: 'In review in the tracker, or its pull request is waiting on reviewers. Longest first.',
  },
  {
    id: 'up_next',
    label: 'Up next',
    rule: 'Assigned to you and not started, by priority, then due date.',
  },
  { id: 'done', label: 'Done recently', rule: 'Done in the last 7 days, most recent first.' },
];

export type TicketView = 'inbox' | TicketSection;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function compactAge(iso: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(iso));
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / DAY)}d`;
}

function spelledAge(iso: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(iso));
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'} ago`;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return unit(Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return unit(Math.floor(elapsed / HOUR), 'hour');
  return unit(Math.floor(elapsed / DAY), 'day');
}

export function ageTitle(age: TicketAge, now = Date.now()): string {
  return `${age.label} ${spelledAge(age.at, now)}`;
}

export type RowActionKind = 'answer' | 'open-chat' | 'open-pr' | 'start';

export interface RowAction {
  kind: RowActionKind;
  label: string;
  url?: string;
}

const PR_RULES = new Set(['pr-changes', 'pr-approved', 'review-slow']);

export function pullUrl(ticket: InboxTicket): string | null {
  return (
    ticket.pullRequest?.url ?? ticket.work.flatMap((work) => work.pullRequests).at(-1)?.url ?? null
  );
}

function chatOrStart(ticket: InboxTicket): RowAction {
  return ticket.chat
    ? { kind: 'open-chat', label: 'Open chat' }
    : { kind: 'start', label: 'Start' };
}

export function rowAction(ticket: InboxTicket): RowAction | null {
  const pr = pullUrl(ticket);
  switch (ticket.section) {
    case 'attention': {
      const lead = ticket.flags[0];
      if (lead?.rule === 'chat-asking') return { kind: 'answer', label: 'Answer' };
      if (lead && PR_RULES.has(lead.rule) && pr)
        return { kind: 'open-pr', label: 'Open PR', url: pr };
      if (ticket.flags.every((flag) => flag.rule === 'sync-failed')) return null;
      return chatOrStart(ticket);
    }
    case 'working':
      return chatOrStart(ticket);
    case 'pr_ready':
    case 'in_review':
      return pr ? { kind: 'open-pr', label: 'Open PR', url: pr } : null;
    case 'up_next':
      return { kind: 'start', label: 'Start' };
    case 'done':
      return null;
  }
}

export interface TicketFilters {
  source: TicketSourceId | 'all';
  project: string;
}

export const ALL_FILTERS: TicketFilters = { source: 'all', project: '' };

export function filterTickets<T extends { source: TicketSourceId; project: string | null }>(
  tickets: readonly T[],
  filters: TicketFilters,
): T[] {
  return tickets.filter(
    (ticket) =>
      (filters.source === 'all' || ticket.source === filters.source) &&
      (!filters.project || ticket.project === filters.project),
  );
}

export function projectsOf(tickets: readonly { project: string | null }[]): string[] {
  return [...new Set(tickets.flatMap((ticket) => (ticket.project ? [ticket.project] : [])))].sort();
}

export type SearchGroup = 'mine' | 'unassigned' | 'others';

export const SEARCH_GROUPS: { id: SearchGroup; label: string }[] = [
  { id: 'mine', label: 'Assigned to you' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'others', label: 'Assigned to others' },
];

export function searchGroup(ticket: TicketSearchResult): SearchGroup {
  if (ticket.mine) return 'mine';
  return ticket.assignedTo ? 'others' : 'unassigned';
}

export function whose(ticket: TicketSearchResult): string {
  if (ticket.mine) return 'Assigned to you';
  return ticket.assignedTo ? `Assigned to ${ticket.assignedTo.name}` : 'Unassigned';
}

export function countBy(tickets: readonly InboxTicket[]): Record<TicketSection, number> {
  const counts = { attention: 0, working: 0, pr_ready: 0, in_review: 0, up_next: 0, done: 0 };
  for (const ticket of tickets) counts[ticket.section] += 1;
  return counts;
}

export const ticketId = (ticket: { source: TicketSourceId; key: string }) =>
  `${ticket.source}:${ticket.key}`;

const ITEM_PREFIX = 'ticket:';

export function inboxIdOf(itemId: string): string | null {
  return itemId.startsWith(ITEM_PREFIX) ? itemId.slice(ITEM_PREFIX.length) : null;
}

const WEB_LINK = /^https?:\/\//i;

export function safeUrl(url: string | null | undefined): string | undefined {
  return url && WEB_LINK.test(url) ? url : undefined;
}
