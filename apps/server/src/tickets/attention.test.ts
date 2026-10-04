import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATTENTION_SETTINGS,
  type PullRequestStatus,
  type TicketListItem,
} from '@spark-outpost/contracts';
import { attentionFlags, dueText, type TicketFacts } from './attention.ts';
import { placeTicket, sortInbox } from './sections.ts';

const now = new Date(2026, 8, 28, 10, 0, 0);
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3_600_000).toISOString();
const CHAT = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-000000000002';

function ticket(fields: Partial<TicketListItem> = {}): TicketListItem {
  return {
    source: 'linear',
    key: 'WEB-1',
    title: 'A ticket',
    status: 'todo',
    statusName: 'Todo',
    url: 'https://linear.app/acme/issue/WEB-1',
    updatedAt: daysAgo(1),
    project: 'WEB',
    priority: 'Medium',
    sprint: null,
    priorityRank: 3,
    assignedTo: { id: 'me', name: 'Alex' },
    labels: [],
    dueDate: null,
    doneAt: null,
    reporter: null,
    createdAt: null,
    work: [],
    ...fields,
  };
}

function facts(fields: Partial<TicketFacts> = {}, ticketFields: Partial<TicketListItem> = {}) {
  return {
    ticket: ticket(ticketFields),
    chat: null,
    pullRequest: null,
    lastSync: null,
    statusSince: daysAgo(1),
    assignedSince: daysAgo(1),
    ...fields,
  } satisfies TicketFacts;
}

const pull = (state: PullRequestStatus['state']): PullRequestStatus => ({
  url: 'https://github.com/acme/web/pull/88',
  repo: 'acme/web',
  number: 88,
  state,
  openedAt: daysAgo(4),
  mergedAt: state === 'merged' ? daysAgo(0) : null,
  checks: null,
});

const work = [{ taskId: TASK, conversationId: CHAT, startedAt: daysAgo(2), pullRequests: [] }];
const rules = (input: TicketFacts) =>
  attentionFlags(input, DEFAULT_ATTENTION_SETTINGS, now).map((flag) => flag.rule);

describe('attention rules', () => {
  it('flags a chat that is waiting on you and a failed move, in rule order', () => {
    const input = facts({
      chat: { conversationId: CHAT, title: 'Chat', state: 'asking', at: daysAgo(0) },
      lastSync: {
        action: 'transition',
        outcome: 'failed',
        message: 'Team required',
        at: daysAgo(0),
      },
    });
    const flags = attentionFlags(input, DEFAULT_ATTENTION_SETTINGS, now);
    expect(flags.map((flag) => [flag.rule, flag.text])).toEqual([
      ['chat-asking', 'Waiting for your answer'],
      ['sync-failed', 'Move failed in Linear'],
    ]);
    expect(flags[1]!.severity).toBe('error');
  });

  it('flags High or Urgent work that has not started after the idle threshold', () => {
    expect(rules(facts({ assignedSince: daysAgo(3) }, { priorityRank: 1 }))).toEqual(['high-idle']);
    expect(rules(facts({ assignedSince: daysAgo(1) }, { priorityRank: 1 }))).toEqual([]);
    expect(rules(facts({ assignedSince: daysAgo(3) }, { priorityRank: 3 }))).toEqual([]);
    expect(rules(facts({ assignedSince: daysAgo(3) }, { priorityRank: 2, work }))).toEqual([]);
    const lenient = { ...DEFAULT_ATTENTION_SETTINGS, idleDays: 5 };
    const input = facts({ assignedSince: daysAgo(3) }, { priorityRank: 2 });
    expect(attentionFlags(input, lenient, now)).toEqual([]);
  });

  it('flags due or overdue work unless it is in review', () => {
    expect(rules(facts({}, { dueDate: '2026-09-29' }))).toEqual(['due-soon']);
    expect(rules(facts({}, { dueDate: '2026-10-06' }))).toEqual([]);
    expect(rules(facts({}, { dueDate: '2026-09-29', status: 'in_review' }))).toEqual([]);
    expect(dueText('2026-09-27', now)).toBe('Overdue');
    expect(dueText('2026-09-28', now)).toBe('Due today');
    expect(dueText('2026-09-29', now)).toBe('Due tomorrow');
    expect(dueText('2026-10-06', now)).toBe('Due Oct 6');
  });

  it('flags blocked work from the status or a label', () => {
    expect(rules(facts({}, { statusName: 'Blocked', status: 'in_progress' }))).toEqual(['blocked']);
    expect(rules(facts({}, { labels: ['blocked'] }))).toEqual(['blocked']);
  });

  it('flags pull requests with changes requested, approved, or slow reviews', () => {
    expect(rules(facts({ pullRequest: pull('changes_requested') }))).toEqual(['pr-changes']);
    expect(rules(facts({ pullRequest: pull('approved') }))).toEqual(['pr-approved']);
    const slow = facts(
      { pullRequest: pull('review'), statusSince: daysAgo(4) },
      { status: 'in_review' },
    );
    expect(attentionFlags(slow, DEFAULT_ATTENTION_SETTINGS, now)[0]).toMatchObject({
      rule: 'review-slow',
      text: 'PR #88 in review',
    });
    const quick = facts({ statusSince: daysAgo(1) }, { status: 'in_review' });
    expect(rules(quick)).toEqual([]);
  });

  it('flags failing checks on an open pull request unless a chat is fixing them', () => {
    const failing = { ...pull('review'), checks: 'failing' as const };
    const input = facts({ pullRequest: failing });
    expect(attentionFlags(input, DEFAULT_ATTENTION_SETTINGS, now)[0]).toMatchObject({
      rule: 'pr-checks',
      text: 'PR #88 checks failing',
      severity: 'error',
    });
    const running = {
      conversationId: CHAT,
      title: 'Chat',
      state: 'running' as const,
      at: now.toISOString(),
    };
    expect(rules(facts({ pullRequest: failing, chat: running }))).toEqual([]);
    expect(rules(facts({ pullRequest: { ...pull('merged'), checks: 'failing' } }))).toEqual([]);
  });

  it('never flags done tickets', () => {
    const done = facts({ assignedSince: daysAgo(9) }, { status: 'done', priorityRank: 1 });
    expect(rules(done)).toEqual([]);
  });
});

describe('snoozed tickets', () => {
  const later = (days: number) => new Date(now.getTime() + days * 24 * 3_600_000).toISOString();
  const slowReview = { statusSince: daysAgo(5) };
  const review = { status: 'in_review' as const };

  it('hides the snoozed rule until the snooze ends', () => {
    const snooze = { until: later(1), rules: ['review-slow' as const] };
    const input = facts({ ...slowReview, snooze }, review);
    expect(rules(input)).toEqual([]);
    const placed = placeTicket(input, DEFAULT_ATTENTION_SETTINGS, now);
    expect(placed.section).toBe('review');
    expect(placed.snooze).toEqual(snooze);
  });

  it('brings the ticket back once the snooze ends', () => {
    const input = facts(
      { ...slowReview, snooze: { until: daysAgo(0.1), rules: ['review-slow'] } },
      review,
    );
    expect(rules(input)).toEqual(['review-slow']);
    const placed = placeTicket(input, DEFAULT_ATTENTION_SETTINGS, now);
    expect(placed.section).toBe('attention');
    expect(placed.snooze).toBeUndefined();
  });

  it('brings the ticket back early when a different rule fires', () => {
    const input = facts(
      {
        ...slowReview,
        pullRequest: pull('changes_requested'),
        snooze: { until: later(3), rules: ['review-slow'] },
      },
      review,
    );
    expect(rules(input)).toEqual(['pr-changes']);
    expect(placeTicket(input, DEFAULT_ATTENTION_SETTINGS, now).section).toBe('attention');
  });
});

describe('inbox sections', () => {
  const place = (input: TicketFacts) => placeTicket(input, DEFAULT_ATTENTION_SETTINGS, now);
  const chat = (state: 'running' | 'finished' | 'idle' | 'asking', more = {}) => ({
    conversationId: CHAT,
    title: 'Chat',
    state,
    at: daysAgo(0),
    ...more,
  });

  it('puts each ticket in the first group of the flow that matches', () => {
    expect(place(facts({}, { dueDate: '2026-09-29' }))).toMatchObject({
      section: 'attention',
      reason: 'Due tomorrow',
      tone: 'warn',
    });
    expect(place(facts({ chat: chat('asking') }))).toMatchObject({
      section: 'attention',
      reason: 'Waiting for your answer',
    });
    expect(place(facts({}, { status: 'done', doneAt: daysAgo(2) }))).toMatchObject({
      section: 'done',
      reason: 'Done',
    });
    expect(place(facts({ pullRequest: pull('merged') }))).toMatchObject({
      section: 'done',
      reason: 'PR #88 merged',
      age: { label: 'Merged' },
    });
    expect(place(facts({ chat: chat('running'), pullRequest: pull('draft') }))).toMatchObject({
      section: 'spark',
      reason: 'Spark working',
      tone: 'running',
    });
    const progress = { done: 8, active: 1, total: 10 };
    expect(place(facts({ chat: chat('running', { progress, agent: 'Pip' }) }))).toMatchObject({
      section: 'spark',
      reason: '8/10 · Pip working',
    });
    expect(place(facts({ pullRequest: pull('draft') }))).toMatchObject({
      section: 'review',
      reason: 'Draft PR #88',
    });
    expect(place(facts({ pullRequest: { ...pull('review'), checks: 'passing' } }))).toMatchObject({
      section: 'review',
      reason: 'PR #88 · checks passing',
    });
    expect(place(facts({}, { status: 'in_review' }))).toMatchObject({
      section: 'review',
      reason: 'In review',
    });
    expect(place(facts({}, { status: 'in_progress' }))).toMatchObject({
      section: 'started',
      reason: 'No chat yet',
    });
    expect(place(facts({ chat: chat('finished') }))).toMatchObject({
      section: 'started',
      reason: 'Chat finished · not shipped',
    });
    expect(place(facts({ chat: chat('idle') }))).toMatchObject({
      section: 'started',
      reason: 'Chat idle',
    });
    expect(place(facts({}, { dueDate: '2026-10-06' }))).toMatchObject({
      section: 'up_next',
      reason: 'Due Oct 6',
      age: { label: 'Assigned' },
    });
  });

  it('keeps a Spark PR in review until its status is known', () => {
    const linked = [{ ...work[0]!, pullRequests: [{ title: 'PR', url: pull('draft').url }] }];
    expect(place(facts({}, { work: linked }))).toMatchObject({
      section: 'review',
      reason: 'PR opened',
    });
  });

  it('orders groups by urgency and sorts attention by rule, then priority', () => {
    const tickets = [
      place(facts({}, { key: 'UP-1', priorityRank: 4 })),
      place(facts({ pullRequest: pull('review') }, { key: 'PR-1' })),
      place(facts({}, { key: 'UP-2', priorityRank: 1, assignedTo: null })),
      place(facts({}, { key: 'DUE-1', dueDate: '2026-09-28', priorityRank: 3 })),
      place(facts({ chat: chat('running') }, { key: 'RUN-1' })),
      place(facts({}, { key: 'GO-1', status: 'in_progress' })),
      place(facts({ chat: chat('asking') }, { key: 'ASK-1' })),
      place(facts({}, { key: 'DONE-1', status: 'done', doneAt: daysAgo(1) })),
    ];
    expect(sortInbox(tickets).map((entry) => entry.key)).toEqual([
      'ASK-1',
      'DUE-1',
      'RUN-1',
      'GO-1',
      'UP-2',
      'UP-1',
      'PR-1',
      'DONE-1',
    ]);
  });
});
