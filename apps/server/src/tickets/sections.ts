import type { InboxTicket, TicketAge, TicketSection } from '@spark-outpost/contracts';
import {
  activeSnooze,
  attentionFlags,
  dueText,
  RULE_ORDER,
  type TicketFacts,
  type Thresholds,
} from './attention.ts';

type Placement = Pick<InboxTicket, 'section' | 'reason' | 'tone' | 'age'>;

const age = (at: string | null | undefined, label: string): TicketAge | null =>
  at ? { at, label } : null;

function working(facts: TicketFacts): Placement | null {
  const { ticket, chat, pullRequest } = facts;
  if (pullRequest?.state === 'merged') {
    return {
      section: 'working',
      reason: `PR #${pullRequest.number} merged`,
      tone: 'none',
      age: age(pullRequest.mergedAt, 'Merged'),
    };
  }
  if (chat?.state === 'running') {
    return { section: 'working', reason: 'Running', tone: 'running', age: age(chat.at, 'Started') };
  }
  if (chat?.state === 'finished') {
    return {
      section: 'working',
      reason: 'Finished, not shipped',
      tone: 'none',
      age: age(chat.at, 'Finished'),
    };
  }
  if (ticket.status !== 'in_progress') return null;
  return {
    section: 'working',
    reason: chat ? 'In progress' : 'In progress · no chat',
    tone: 'none',
    age: age(facts.statusSince, 'Started'),
  };
}

function prReady(facts: TicketFacts): Placement | null {
  const pull = facts.pullRequest;
  if (pull?.state === 'draft') {
    return {
      section: 'pr_ready',
      reason: `Draft PR #${pull.number}`,
      tone: 'none',
      age: age(pull.openedAt, 'Opened'),
    };
  }
  const linked = facts.ticket.work.flatMap((work) => work.pullRequests);
  if (pull || linked.length === 0 || facts.ticket.status === 'in_review') return null;
  return {
    section: 'pr_ready',
    reason: 'Draft PR',
    tone: 'none',
    age: age(facts.ticket.work.at(-1)?.startedAt, 'Started'),
  };
}

function inReview(facts: TicketFacts): Placement | null {
  const pull = facts.pullRequest;
  const reviewing = pull && ['review', 'approved', 'changes_requested'].includes(pull.state);
  if (facts.ticket.status !== 'in_review' && !reviewing) return null;
  return {
    section: 'in_review',
    reason: pull ? `PR #${pull.number} in review` : 'In review',
    tone: 'none',
    age: age(facts.statusSince ?? pull?.openedAt, 'Entered review'),
  };
}

function upNext(facts: TicketFacts, now: Date): Placement {
  const { ticket } = facts;
  return {
    section: 'up_next',
    reason: ticket.dueDate ? dueText(ticket.dueDate, now) : 'Not started',
    tone: 'none',
    age: age(facts.assignedSince, 'Assigned'),
  };
}

export function placeTicket(facts: TicketFacts, limits: Thresholds, now: Date): InboxTicket {
  const flags = attentionFlags(facts, limits, now);
  const snooze = activeSnooze(facts, now);
  const lead = flags[0];
  const placement: Placement = lead
    ? {
        section: 'attention',
        reason: lead.text,
        tone: lead.severity,
        age: age(lead.since ?? facts.statusSince, 'Since'),
      }
    : facts.ticket.status === 'done'
      ? { section: 'done', reason: 'Done', tone: 'none', age: age(facts.ticket.doneAt, 'Done') }
      : (prReady(facts) ?? working(facts) ?? inReview(facts) ?? upNext(facts, now));
  return {
    ...facts.ticket,
    ...placement,
    flags,
    chat: facts.chat
      ? {
          conversationId: facts.chat.conversationId,
          title: facts.chat.title,
          state: facts.chat.state,
        }
      : null,
    pullRequest: facts.pullRequest,
    lastSync: facts.lastSync,
    ...(snooze ? { snooze } : {}),
  };
}

const rank = (ticket: InboxTicket) => ticket.priorityRank || 5;
const newestFirst = (a: string | undefined, b: string | undefined) =>
  (b ?? '').localeCompare(a ?? '');

const ORDER: Record<TicketSection, (a: InboxTicket, b: InboxTicket) => number> = {
  attention: (a, b) =>
    RULE_ORDER.indexOf(a.flags[0]!.rule) - RULE_ORDER.indexOf(b.flags[0]!.rule) ||
    rank(a) - rank(b),
  done: (a, b) => newestFirst(a.doneAt ?? a.updatedAt, b.doneAt ?? b.updatedAt),
  pr_ready: (a, b) => newestFirst(a.age?.at, b.age?.at),
  working: (a, b) => newestFirst(a.updatedAt, b.updatedAt),
  in_review: (a, b) => (a.age?.at ?? '').localeCompare(b.age?.at ?? ''),
  up_next: (a, b) => rank(a) - rank(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
};

export const SECTION_ORDER: readonly TicketSection[] = [
  'attention',
  'working',
  'pr_ready',
  'in_review',
  'up_next',
  'done',
];

export function sortInbox(tickets: readonly InboxTicket[]): InboxTicket[] {
  return SECTION_ORDER.flatMap((section) =>
    tickets.filter((ticket) => ticket.section === section).toSorted(ORDER[section]),
  );
}
