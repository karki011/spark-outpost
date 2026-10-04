import {
  sparkWorkingText,
  ticketSectionSchema,
  type InboxTicket,
  type PullRequestChecks,
  type PullRequestStatus,
  type TicketAge,
  type TicketSection,
} from '@spark-outpost/contracts';
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

function finished(facts: TicketFacts): Placement | null {
  const { ticket, pullRequest: pull } = facts;
  if (ticket.status === 'done') {
    return { section: 'done', reason: 'Done', tone: 'none', age: age(ticket.doneAt, 'Done') };
  }
  if (pull?.state !== 'merged') return null;
  return {
    section: 'done',
    reason: `PR #${pull.number} merged`,
    tone: 'none',
    age: age(pull.mergedAt, 'Merged'),
  };
}

function withSpark({ chat }: TicketFacts): Placement | null {
  if (chat?.state !== 'running') return null;
  return {
    section: 'spark',
    reason: sparkWorkingText(chat.progress ?? null, chat.agent ?? null),
    tone: 'running',
    age: age(chat.at, 'Started'),
  };
}

const CHECKS_TEXT: Record<PullRequestChecks, string> = {
  passing: 'checks passing',
  failing: 'checks failing',
  pending: 'checks running',
};

function pullText(pull: PullRequestStatus): string {
  if (pull.state === 'draft') return `Draft PR #${pull.number}`;
  if (pull.checks) return `PR #${pull.number} · ${CHECKS_TEXT[pull.checks]}`;
  return `PR #${pull.number} in review`;
}

function inReview(facts: TicketFacts): Placement | null {
  const { ticket, pullRequest: pull } = facts;
  const since = facts.statusSince ?? pull?.openedAt ?? ticket.work.at(-1)?.startedAt;
  const placed = (reason: string): Placement => ({
    section: 'review',
    reason,
    tone: 'none',
    age: age(since, 'In review'),
  });
  if (pull && pull.state !== 'closed') return placed(pullText(pull));
  if (!pull && ticket.work.some((work) => work.pullRequests.length > 0)) {
    return placed('PR opened');
  }
  return ticket.status === 'in_review' ? placed('In review') : null;
}

function started(facts: TicketFacts): Placement | null {
  const { ticket, chat } = facts;
  if (chat?.state === 'finished') {
    return {
      section: 'started',
      reason: 'Chat finished · not shipped',
      tone: 'none',
      age: age(chat.at, 'Finished'),
    };
  }
  if (ticket.status !== 'in_progress' && !chat) return null;
  return {
    section: 'started',
    reason: chat ? 'Chat idle' : 'No chat yet',
    tone: 'none',
    age: age(facts.statusSince ?? chat?.at, 'Started'),
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
    : (finished(facts) ??
      withSpark(facts) ??
      inReview(facts) ??
      started(facts) ??
      upNext(facts, now));
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
  spark: (a, b) => newestFirst(a.age?.at, b.age?.at),
  started: (a, b) => rank(a) - rank(b) || newestFirst(a.updatedAt, b.updatedAt),
  up_next: (a, b) => rank(a) - rank(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
  review: (a, b) => (a.age?.at ?? '').localeCompare(b.age?.at ?? ''),
  done: (a, b) => newestFirst(a.age?.at ?? a.updatedAt, b.age?.at ?? b.updatedAt),
};

export function sortInbox(tickets: readonly InboxTicket[]): InboxTicket[] {
  return ticketSectionSchema.options.flatMap((section) =>
    tickets.filter((ticket) => ticket.section === section).toSorted(ORDER[section]),
  );
}
