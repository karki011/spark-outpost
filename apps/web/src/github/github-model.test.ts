import { describe, expect, it } from 'vitest';
import type { GithubInbox, GithubInboxItem } from '@spark-outpost/contracts';
import { inboxItem as item } from './inbox-item-fixture.ts';
import {
  type ListEntry,
  ageLabel,
  botsState,
  defaultGroup,
  filterByProject,
  groupItems,
  hasUpdates,
  listEntries,
  markSeen,
  prState,
  sizeLine,
  tileLine,
} from './github-model.ts';

function ids(entries: ListEntry[]): string[] {
  return entries.map((entry) =>
    entry.kind === 'item' ? entry.item.id : `bots:${entry.items.map((bot) => bot.id).join(',')}`,
  );
}

const NOW = Date.parse('2026-11-16T12:00:00Z');

function inbox(items: GithubInboxItem[], connected = true): GithubInbox {
  return { connected, login: 'me', windowDays: 14, fetchedAt: null, items, problems: [] };
}

describe('ageLabel', () => {
  it('counts minutes, hours, days and weeks', () => {
    expect(ageLabel('2026-11-16T11:59:30Z', NOW)).toBe('now');
    expect(ageLabel('2026-11-16T11:30:00Z', NOW)).toBe('30 min');
    expect(ageLabel('2026-11-16T07:00:00Z', NOW)).toBe('5 h');
    expect(ageLabel('2026-11-14T12:00:00Z', NOW)).toBe('2 d');
    expect(ageLabel('2026-09-01T12:00:00Z', NOW)).toBe('10 w');
  });
});

describe('prState', () => {
  it('puts draft, then conflict, then checks', () => {
    expect(prState(item({ draft: true, conflict: true }))).toBe('draft');
    expect(prState(item({ conflict: true, checks: 'failing' }))).toBe('conflict');
    expect(prState(item({ checks: 'passing', failingChecks: 1 }))).toBe('failing');
    expect(prState(item({ checks: 'pending' }))).toBe('running');
    expect(prState(item({ checks: null }))).toBeNull();
  });

  it('sums bot updates', () => {
    expect(botsState([item(), item()])).toBe('passing');
    expect(botsState([item(), item({ checks: 'pending' })])).toBe('running');
    expect(botsState([item({ checks: 'failing' }), item({ checks: 'pending' })])).toBe('failing');
    expect(botsState([item(), item({ checks: null })])).toBeNull();
  });
});

describe('groups and tiles', () => {
  const items = [
    item({ id: 'a', group: 'needs_fixes', checks: 'failing' }),
    item({ id: 'b', group: 'needs_fixes', conflict: true, projectId: 'p1' }),
    item({ id: 'c', group: 'waiting', updatedAt: '2026-11-13T12:00:00Z', projectId: 'p1' }),
  ];

  it('picks the first group that has items', () => {
    expect(defaultGroup(groupItems(items))).toBe('needs_fixes');
    expect(defaultGroup(groupItems([]))).toBe('review_requested');
  });

  it('filters by project before grouping', () => {
    const grouped = groupItems(filterByProject(items, 'p1'));
    expect(grouped.needs_fixes.map((entry) => entry.id)).toEqual(['b']);
    expect(filterByProject(items, '')).toHaveLength(3);
  });

  it('writes one line per tile', () => {
    const grouped = groupItems(items);
    expect(tileLine('needs_fixes', grouped.needs_fixes, NOW)).toBe('1 failing · 1 conflict');
    expect(tileLine('waiting', grouped.waiting, NOW)).toBe('Oldest 3 days');
    expect(tileLine('ready_to_merge', [item()], NOW)).toBe('Approved, checks pass');
    expect(tileLine('review_requested', [item({ unseen: true }), item()], NOW)).toBe('1 new');
    expect(tileLine('review_requested', [item()], NOW)).toBe('All seen');
    expect(tileLine('ready_to_merge', [], NOW)).toBe('Nothing here');
  });
});

describe('listEntries', () => {
  it('sorts review requests unseen first, then oldest, drafts last', () => {
    const entries = listEntries('review_requested', [
      item({ id: 'draft', draft: true, unseen: true, updatedAt: '2026-11-01T00:00:00Z' }),
      item({ id: 'seen-old', updatedAt: '2026-11-02T00:00:00Z' }),
      item({ id: 'new-late', unseen: true, updatedAt: '2026-11-10T00:00:00Z' }),
      item({ id: 'new-early', unseen: true, updatedAt: '2026-11-05T00:00:00Z' }),
    ]);
    expect(ids(entries)).toEqual(['new-early', 'new-late', 'seen-old', 'draft']);
  });

  it('collapses two or more bot review requests into one row', () => {
    const entries = listEntries('review_requested', [
      item({ id: 'person' }),
      item({ id: 'bot1', authorIsBot: true }),
      item({ id: 'bot2', authorIsBot: true }),
    ]);
    expect(ids(entries)).toEqual(['person', 'bots:bot1,bot2']);
  });

  it('keeps a single bot and bots outside review requests as rows', () => {
    expect(listEntries('review_requested', [item({ authorIsBot: true })])[0]!.kind).toBe('item');
    const waiting = listEntries('waiting', [
      item({ authorIsBot: true }),
      item({ authorIsBot: true }),
    ]);
    expect(waiting.every((entry) => entry.kind === 'item')).toBe(true);
  });
});

describe('seen', () => {
  it('clears the marks only for the head that was seen', () => {
    const before = inbox([item({ id: 'a', unseen: true, updatedSinceSeen: true })]);
    expect(markSeen(before, 'a', 'abc')!.items[0]).toMatchObject({
      unseen: false,
      updatedSinceSeen: false,
    });
    expect(markSeen(before, 'a', 'other')!.items[0]!.unseen).toBe(true);
    expect(markSeen(undefined, 'a', 'abc')).toBeUndefined();
  });

  it('shows the rail dot only when connected with something fresh', () => {
    expect(hasUpdates(inbox([item({ updatedSinceSeen: true })]))).toBe(true);
    expect(hasUpdates(inbox([item()]))).toBe(false);
    expect(hasUpdates(inbox([item({ unseen: true })], false))).toBe(false);
    expect(hasUpdates(undefined)).toBe(false);
  });
});

describe('sizeLine', () => {
  it('says lines and files, or nothing when unknown', () => {
    expect(sizeLine(item())).toBe('+10 −2 in 3 files');
    expect(sizeLine(item({ changedFiles: 1 }))).toBe('+10 −2 in 1 file');
    expect(sizeLine(item({ additions: null }))).toBeNull();
  });
});
