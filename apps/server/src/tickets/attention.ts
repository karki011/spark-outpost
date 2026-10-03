import {
  ticketSourceNames,
  type AttentionFlag,
  type AttentionRule,
  type AttentionSettings,
  type PlanProgress,
  type PullRequestStatus,
  type TicketChatState,
  type TicketLastSync,
  type TicketListItem,
  type TicketSnooze,
} from '@spark-outpost/contracts';

export type Thresholds = Pick<AttentionSettings, 'idleDays' | 'dueDays' | 'reviewDays'>;

export interface TicketFacts {
  ticket: TicketListItem;
  chat: {
    conversationId: string;
    title: string;
    state: TicketChatState;
    at: string;
    progress?: PlanProgress | null;
    agent?: string | null;
  } | null;
  pullRequest: PullRequestStatus | null;
  lastSync: TicketLastSync | null;
  statusSince: string | null;
  assignedSince: string | null;
  snooze?: TicketSnooze | null;
  prFeedback?: PrFeedbackWaiting | null;
}

export interface PrFeedbackWaiting {
  number: number;
  waiting: number;
  since: string;
}

export function activeSnooze(facts: TicketFacts, now: Date): TicketSnooze | null {
  const snooze = facts.snooze;
  return snooze && Date.parse(snooze.until) > now.getTime() ? snooze : null;
}

export const RULE_ORDER: readonly AttentionRule[] = [
  'chat-asking',
  'chat-error',
  'pr-feedback',
  'pr-checks',
  'sync-failed',
  'blocked',
  'high-idle',
  'due-soon',
  'pr-changes',
  'pr-approved',
  'review-slow',
];

const DAY_MS = 24 * 3_600_000;
const BLOCKED = /\b(blocked|on hold)\b/i;
const SYNC_VERBS: Record<TicketLastSync['action'], string> = {
  transition: 'Move',
  link_pr: 'PR link',
  assign: 'Assign',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function localDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function dueDay(dueDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueDate);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export function daysUntilDue(dueDate: string, now: Date): number | null {
  const day = dueDay(dueDate);
  return day === null ? null : Math.round((day - localDay(now)) / DAY_MS);
}

export function dueText(dueDate: string, now: Date): string {
  const days = daysUntilDue(dueDate, now);
  if (days === null) return 'Has a due date';
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  const date = new Date(dueDay(dueDate)!);
  return `Due ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function olderThan(iso: string | null, days: number, now: Date): boolean {
  return iso !== null && now.getTime() - Date.parse(iso) >= days * DAY_MS;
}

const flag = (
  rule: AttentionRule,
  text: string,
  rationale: string,
  since: string | null,
  severity: AttentionFlag['severity'] = 'warn',
): AttentionFlag => ({ rule, text, rationale, since, severity });

function chatFlags(facts: TicketFacts): AttentionFlag[] {
  if (facts.chat?.state === 'asking') {
    return [
      flag(
        'chat-asking',
        'Waiting for your answer',
        'Rule: A chat linked to this ticket asked you a question.',
        facts.chat.at,
      ),
    ];
  }
  if (facts.chat?.state === 'error') {
    return [
      flag(
        'chat-error',
        'Chat stopped with an error',
        'Rule: The chat linked to this ticket stopped with an error.',
        facts.chat.at,
        'error',
      ),
    ];
  }
  return [];
}

function feedbackFlags({ prFeedback }: TicketFacts): AttentionFlag[] {
  if (!prFeedback || prFeedback.waiting === 0) return [];
  return [
    flag(
      'pr-feedback',
      `PR #${prFeedback.number} feedback needs you`,
      `Rule: Spark is following up on the linked pull request and ${plural(prFeedback.waiting, 'item')} need${prFeedback.waiting === 1 ? 's' : ''} your call.`,
      prFeedback.since,
    ),
  ];
}

function checksFlags({ pullRequest: pull, chat }: TicketFacts): AttentionFlag[] {
  const open = pull && pull.state !== 'merged' && pull.state !== 'closed';
  if (!open || pull.checks !== 'failing' || chat?.state === 'running') return [];
  return [
    flag(
      'pr-checks',
      `PR #${pull.number} checks failing`,
      'Rule: Checks are failing on the linked pull request and no chat is fixing them.',
      null,
      'error',
    ),
  ];
}

function syncFlags({ ticket, lastSync }: TicketFacts): AttentionFlag[] {
  if (lastSync?.outcome !== 'failed') return [];
  const where = ticketSourceNames[ticket.source];
  return [
    flag(
      'sync-failed',
      `${SYNC_VERBS[lastSync.action]} failed in ${where}`,
      `Rule: Spark could not change this ticket in ${where}.`,
      lastSync.at,
      'error',
    ),
  ];
}

function workFlags(facts: TicketFacts, limits: Thresholds, now: Date): AttentionFlag[] {
  const { ticket } = facts;
  const flags: AttentionFlag[] = [];
  const blocked = BLOCKED.test(ticket.statusName) || ticket.labels.some((l) => BLOCKED.test(l));
  if (blocked) {
    flags.push(flag('blocked', 'Blocked', "Rule: The status or a label says it's blocked.", null));
  }
  const important = ticket.priorityRank === 1 || ticket.priorityRank === 2;
  const idle = ticket.status === 'todo' && ticket.work.length === 0;
  if (important && idle && olderThan(facts.assignedSince, limits.idleDays, now)) {
    flags.push(
      flag(
        'high-idle',
        `${ticket.priorityRank === 1 ? 'Urgent' : 'High'} · not started`,
        `Rule: High or Urgent, not started, assigned to you ${plural(limits.idleDays, 'day')} ago or more.`,
        facts.assignedSince,
      ),
    );
  }
  const due = ticket.dueDate ? daysUntilDue(ticket.dueDate, now) : null;
  if (due !== null && due <= limits.dueDays && ticket.status !== 'in_review') {
    flags.push(
      flag(
        'due-soon',
        dueText(ticket.dueDate!, now),
        `Rule: Due within ${plural(limits.dueDays, 'day')} or overdue, not in review or done.`,
        null,
        due < 0 ? 'error' : 'warn',
      ),
    );
  }
  return flags;
}

function pullFlags(facts: TicketFacts, limits: Thresholds, now: Date): AttentionFlag[] {
  const pull = facts.pullRequest;
  const flags: AttentionFlag[] = [];
  if (pull?.state === 'changes_requested') {
    flags.push(
      flag(
        'pr-changes',
        `PR #${pull.number} changes requested`,
        'Rule: A reviewer asked for changes on the linked pull request.',
        null,
      ),
    );
  }
  if (pull?.state === 'approved') {
    flags.push(
      flag(
        'pr-approved',
        `PR #${pull.number} approved`,
        'Rule: The linked pull request is approved and waiting for you to merge it.',
        null,
      ),
    );
  }
  const inReview = facts.ticket.status === 'in_review' || pull?.state === 'review';
  const since = facts.statusSince ?? pull?.openedAt ?? null;
  if (inReview && olderThan(since, limits.reviewDays, now)) {
    flags.push(
      flag(
        'review-slow',
        pull ? `PR #${pull.number} in review` : 'In review',
        `Rule: In review ${plural(limits.reviewDays, 'day')} or more.`,
        since,
      ),
    );
  }
  return flags;
}

export function attentionFlags(facts: TicketFacts, limits: Thresholds, now: Date): AttentionFlag[] {
  if (facts.ticket.status === 'done') return [];
  const flags = [
    ...chatFlags(facts),
    ...feedbackFlags(facts),
    ...checksFlags(facts),
    ...syncFlags(facts),
    ...workFlags(facts, limits, now),
    ...pullFlags(facts, limits, now),
  ];
  const snoozed = activeSnooze(facts, now)?.rules ?? [];
  return flags
    .filter((entry) => !snoozed.includes(entry.rule))
    .toSorted((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
}
