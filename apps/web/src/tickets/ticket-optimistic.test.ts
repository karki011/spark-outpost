import { describe, expect, it } from 'vitest';
import type { AttentionFlag, InboxTicket, TicketInbox } from '@spark-outpost/contracts';
import {
  attentionCount,
  findTicket,
  replaceTicket,
  snoozedTicket,
  withoutAttention,
  wokenTicket,
} from './ticket-optimistic.ts';

const flag: AttentionFlag = {
  rule: 'blocked',
  key: 'blocked:1',
  text: 'Blocked',
  rationale: 'Blocked in the tracker',
  since: null,
  severity: 'warn',
};

function ticket(key: string, fields: Partial<InboxTicket> = {}): InboxTicket {
  return {
    source: 'linear',
    key,
    title: key,
    status: 'todo',
    statusName: 'Todo',
    url: `https://linear.app/acme/issue/${key}`,
    updatedAt: '2026-09-27T10:00:00.000Z',
    project: 'WEB',
    priority: 'High',
    sprint: null,
    priorityRank: 2,
    assignedTo: { id: 'me', name: 'Alex' },
    labels: [],
    dueDate: null,
    doneAt: null,
    reporter: null,
    createdAt: null,
    work: [],
    section: 'attention',
    flags: [flag],
    reason: 'Blocked',
    tone: 'warn',
    age: null,
    chat: null,
    pullRequest: null,
    lastSync: null,
    ...fields,
  };
}

const inboxOf = (...tickets: InboxTicket[]): TicketInbox => ({
  tickets,
  errors: [],
  sources: ['linear'],
  truncated: [],
  syncedAt: '2026-09-27T10:00:00.000Z',
  settings: {} as TicketInbox['settings'],
});

describe('withoutAttention', () => {
  it('drops the flags and moves the ticket to the section its status implies', () => {
    expect(withoutAttention(ticket('A')).section).toBe('up_next');
    expect(withoutAttention(ticket('A', { status: 'in_progress' })).section).toBe('started');
    expect(withoutAttention(ticket('A', { status: 'in_review' })).section).toBe('review');
    expect(withoutAttention(ticket('A', { status: 'done' })).section).toBe('done');
    expect(
      withoutAttention(
        ticket('A', { chat: { conversationId: 'c', title: 't', state: 'running' } }),
      ),
    ).toMatchObject({ section: 'spark', flags: [], tone: 'none' });
  });
});

describe('snoozedTicket and wokenTicket', () => {
  it('marks the snooze with the flagged rules and removes it again', () => {
    const until = new Date('2026-10-01T08:00:00.000Z');
    const snoozed = snoozedTicket(ticket('A'), until);
    expect(snoozed).toMatchObject({
      flags: [],
      reason: 'Snoozed',
      snooze: { until: until.toISOString(), rules: ['blocked'] },
    });
    expect(wokenTicket(snoozed)).not.toHaveProperty('snooze');
  });
});

describe('inbox patching', () => {
  it('replaces one ticket, keeps the others by reference and lowers the attention count', () => {
    const first = ticket('A');
    const second = ticket('B');
    const inbox = inboxOf(first, second);
    expect(attentionCount(inbox)).toBe(2);
    const next = replaceTicket(inbox, withoutAttention(first));
    expect(next.tickets[1]).toBe(second);
    expect(attentionCount(next)).toBe(1);
    expect(findTicket(next, first)?.section).toBe('up_next');
    expect(attentionCount(undefined)).toBe(0);
  });
});
