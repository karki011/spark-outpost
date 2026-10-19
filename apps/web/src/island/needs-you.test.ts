import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import type { CalendarLine } from '../calendar/island-calendar.ts';
import type { Card } from './island-model.ts';
import { NEEDS_YOU_ROWS, needsYou } from './needs-you.ts';

function chat(id: string, patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    title: `Chat ${id}`,
    updatedAt: '2026-09-30T10:00:00.000Z',
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...patch,
  };
}

const run = (status: string, finishedAt: string | null = null) =>
  ({
    id: `run-${status}`,
    status,
    finishedAt,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
  }) as ConversationSummary['latestRun'];

const card = (id: string, loading = false): Card => ({
  kind: 'open',
  chat: chat(id, { needsInput: true }),
  approval: null,
  loading,
});

function line(kind: CalendarLine['kind'], text: string): CalendarLine {
  return {
    kind,
    key: `${kind}:x`,
    eventKey: 'x',
    text,
    event: null,
    join: null,
    choose: null,
    capture: null,
    dismiss: null,
  };
}

describe('needsYou', () => {
  it('lists waiting cards, then the meeting line, then failed and finished chats not yet seen', () => {
    const chats = [
      chat('done', { unread: true, latestRun: run('succeeded') }),
      chat('failed', { latestRun: run('failed', '2026-09-30T10:05:00Z'), seenAt: null }),
      chat('seen', {
        latestRun: run('failed', '2026-09-30T10:05:00Z'),
        seenAt: '2026-09-30T10:06:00Z',
      }),
      chat('done-seen', { unread: false, latestRun: run('succeeded') }),
      chat('running', { unread: true, latestRun: run('running') }),
      chat('archived', {
        unread: true,
        latestRun: run('failed', '2026-09-30T10:05:00Z'),
        archivedAt: '2026-09-30T10:00:00Z',
      }),
    ];
    const result = needsYou([card('a')], chats, line('nudge', 'Standup in 5 min'));
    expect(result.rows.map((row) => [row.kind, row.text])).toEqual([
      ['waiting', 'Chat a needs you'],
      ['calendar', 'Standup in 5 min'],
      ['failed', 'Chat failed couldn’t finish.'],
      ['done', 'Chat done is done.'],
    ]);
    expect(result.more).toBe(0);
  });

  it('leaves out a hold or a plain Join line, which are not things to do', () => {
    expect(needsYou([], [], line('hold', 'Focus · alerts held until 11:30')).rows).toEqual([]);
    expect(needsYou([], [], line('join', 'Standup now')).rows).toEqual([]);
    expect(
      needsYou([], [], line('catch-up', 'While you were in Focus: 1 chat needs you')).rows,
    ).toHaveLength(1);
  });

  it('shows a few rows and counts the rest', () => {
    const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => card(id));
    const result = needsYou([...cards, card('loading', true)], [], null);
    expect(result.rows).toHaveLength(NEEDS_YOU_ROWS);
    expect(result.more).toBe(6 - NEEDS_YOU_ROWS);
  });
});
