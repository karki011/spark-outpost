import { describe, expect, it } from 'vitest';
import type { AttentionItem, ConversationSummary } from '@spark-outpost/contracts';
import { awayKeys, capRows, sinceRows } from './since-model.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function chat(n: number, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: id(n),
    title: `Chat ${n}`,
    updatedAt: '2026-11-10T08:00:00.000Z',
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
    ...overrides,
  } as ConversationSummary;
}

function item(
  n: number,
  kind: AttentionItem['kind'],
  at: string,
  overrides: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    key: `${kind}:${id(n)}`,
    kind,
    blocking: kind === 'approval' || kind === 'terminal',
    conversationId: id(n),
    detail: null,
    at,
    readAt: null,
    setAsideAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

const NOW = Date.parse('2026-11-10T12:00:00.000Z');

const chats = [1, 2, 3, 4, 5, 6, 7].map((n) => chat(n));

describe('awayKeys', () => {
  it('keeps unread finished, failed and clean updates and nothing else', () => {
    const items = [
      item(1, 'run-done', '2026-11-10T01:00:00Z'),
      item(2, 'run-failed', '2026-11-10T02:00:00Z'),
      item(3, 'pr-clean', '2026-11-10T03:00:00Z'),
      item(4, 'run-done', '2026-11-10T04:00:00Z', { readAt: '2026-11-10T05:00:00Z' }),
      item(5, 'approval', '2026-11-10T05:00:00Z'),
      item(6, 'flag', '2026-11-10T06:00:00Z'),
      item(7, 'run-done', '2026-11-10T07:00:00Z', { dismissedAt: '2026-11-10T08:00:00Z' }),
    ];
    expect([...awayKeys(items, null, NOW)].sort()).toEqual(
      [items[0]!.key, items[1]!.key, items[2]!.key].sort(),
    );
  });

  describe('the away rule', () => {
    const SEEN = '2026-11-10T08:00:00.000Z';
    const seenMs = Date.parse(SEEN);
    const items = [
      item(1, 'run-done', '2026-11-10T07:59:59.999Z'),
      item(2, 'run-done', SEEN),
      item(3, 'run-failed', '2026-11-10T08:00:00.001Z'),
      item(4, 'pr-clean', '2026-11-10T08:20:00.000Z'),
    ];
    const keys = (now: number) => [...awayKeys(items, SEEN, now)].sort();

    it('shows nothing until the user has been away 30 minutes', () => {
      expect(keys(seenMs + 29 * 60_000 + 59_999)).toEqual([]);
    });

    it('is away from exactly 30 minutes and lists only updates after the last visit', () => {
      expect(keys(seenMs + 30 * 60_000)).toEqual([items[2]!.key, items[3]!.key].sort());
    });

    it('lists every unread update when Home has never been seen', () => {
      expect(awayKeys(items, null, NOW).size).toBe(4);
    });

    it('treats an unreadable last-seen time as never seen', () => {
      expect(awayKeys(items, 'not a date', NOW).size).toBe(4);
    });
  });
});

describe('sinceRows', () => {
  const items = [
    item(1, 'run-done', '2026-11-10T07:00:00Z'),
    item(2, 'pr-clean', '2026-11-10T06:00:00Z'),
    item(3, 'approval', '2026-11-10T05:00:00Z'),
    item(4, 'run-failed', '2026-11-10T01:00:00Z'),
    item(5, 'run-failed', '2026-11-10T02:00:00Z'),
  ];

  it('puts failed first, then waiting cards, clean pull requests and finished turns', () => {
    const rows = sinceRows(items, awayKeys(items, null, NOW), chats);
    expect(rows.map((row) => [row.chat.title, row.kind])).toEqual([
      ['Chat 5', 'failed'],
      ['Chat 4', 'failed'],
      ['Chat 3', 'waiting'],
      ['Chat 2', 'clean'],
      ['Chat 1', 'finished'],
    ]);
  });

  it('drops rows once read, unless a card still waits, and skips archived chats', () => {
    const away = awayKeys(items, null, NOW);
    const handled = items.map((entry) =>
      entry.kind === 'run-done' || entry.kind === 'approval'
        ? { ...entry, readAt: '2026-11-10T08:00:00Z' }
        : entry,
    );
    const rows = sinceRows(handled, away, [...chats.slice(0, 4), chat(5, { archivedAt: 'x' })]);
    expect(rows.map((row) => row.chat.title)).toEqual(['Chat 4', 'Chat 3', 'Chat 2']);
    expect(rows.find((row) => row.kind === 'waiting')?.unread).toBe(false);
  });

  it('leaves updates that arrived after the away snapshot to the board', () => {
    const rows = sinceRows(items, new Set([items[0]!.key]), chats);
    expect(rows.map((row) => row.kind)).toEqual(['waiting', 'finished']);
  });

  it('describes each row with a fixed line when the chat has no better one', () => {
    const rows = sinceRows(items, awayKeys(items, null, NOW), chats);
    expect(rows.map((row) => row.line)).toEqual([
      'The turn stopped with an error',
      'The turn stopped with an error',
      'Waiting for your answer',
      'PR is clean · ready to merge',
      'Finished · open to review',
    ]);
  });

  it('groups the runs of a schedule into one line', () => {
    const schedule = {
      workflowId: 'pre-pr-review',
      name: 'Pre-PR review',
      runsToday: 12,
      failedToday: 1,
    };
    const grouped = [{ ...items[0]!, schedule }];
    const rows = sinceRows(grouped, awayKeys(grouped, null, NOW), chats);
    expect(rows.map((row) => row.line)).toEqual(['Pre-PR review: 12 runs today, 1 failed']);
  });
});

describe('capRows', () => {
  it('keeps five rows and reports the rest', () => {
    const { shown, more } = capRows([1, 2, 3, 4, 5, 6, 7]);
    expect(shown).toEqual([1, 2, 3, 4, 5]);
    expect(more).toEqual([6, 7]);
    expect(capRows([1, 2]).more).toEqual([]);
  });
});
