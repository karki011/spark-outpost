import { describe, expect, it } from 'vitest';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import {
  activeGroups,
  historyGroups,
  looseBuckets,
  movedOrder,
  movedProjectIds,
  pinnedFirst,
  pinnedSiblings,
} from './sidebar-groups.ts';

const project = (id: string, name: string): Project => ({
  id,
  name,
  rootPath: `/code/${name}`,
  displayPath: `~/code/${name}`,
  createdAt: '2026-09-01T00:00:00.000Z',
  commandAllowlist: [],
});

const chat = (id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: id,
  updatedAt: '2026-09-26T10:00:00.000Z',
  projectIds: [],
  latestRun: null,
  archivedAt: null,
  pinnedAt: null,
  pinnedOrder: null,
  unread: false,
  needsInput: false,
  attention: null,
  titleSource: 'message',
  category: null,
  ...extra,
});

describe('activeGroups', () => {
  it('groups chats under their primary repo and keeps empty projects', () => {
    const web = project('web', 'web-apps');
    const docs = project('docs', 'docs');
    const result = activeGroups(
      [
        chat('a', { projectIds: ['docs', 'web'] }),
        chat('b', { projectIds: ['web'] }),
        chat('c'),
        chat('d', { projectIds: ['gone'] }),
        chat('e', { projectIds: ['web'], archivedAt: '2026-09-26T09:00:00.000Z' }),
      ],
      [web, docs],
    );
    expect(result.groups.map((group) => [group.project.id, group.chats.map((c) => c.id)])).toEqual([
      ['web', ['b']],
      ['docs', ['a']],
    ]);
    expect(result.loose.map((c) => c.id)).toEqual(['c', 'd']);
  });

  it('puts pinned chats first, newest pin on top, and keeps the rest in order', () => {
    const result = activeGroups(
      [
        chat('a'),
        chat('b', { pinnedAt: '2026-09-25T00:00:00.000Z' }),
        chat('c'),
        chat('d', { pinnedAt: '2026-09-26T00:00:00.000Z' }),
      ],
      [],
    );
    expect(result.loose.map((c) => c.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});

describe('historyGroups', () => {
  it('buckets archived chats by when they were archived, newest first', () => {
    const now = new Date(2026, 8, 26, 15).getTime();
    const at = (days: number) => new Date(2026, 8, 26 - days, 9).toISOString();
    const groups = historyGroups(
      [
        chat('old', { archivedAt: at(40) }),
        chat('today', { archivedAt: at(0) }),
        chat('active'),
        chat('week', { archivedAt: at(3) }),
      ],
      now,
    );
    expect(groups.map((group) => [group.label, group.chats.map((c) => c.id)])).toEqual([
      ['Today', ['today']],
      ['Previous 7 days', ['week']],
      ['August', ['old']],
    ]);
  });
});

describe('looseBuckets', () => {
  it('buckets unpinned chats by last activity and leaves pinned chats out', () => {
    const now = new Date(2026, 8, 26, 15).getTime();
    const at = (days: number) => new Date(2026, 8, 26 - days, 9).toISOString();
    const groups = looseBuckets(
      [
        chat('pinned', { updatedAt: at(0), pinnedAt: at(0) }),
        chat('last-week', { updatedAt: at(5) }),
        chat('today', { updatedAt: at(0) }),
        chat('yesterday', { updatedAt: at(1) }),
      ],
      now,
    );
    expect(groups.map((group) => [group.label, group.chats.map((c) => c.id)])).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['last-week']],
    ]);
  });
});

describe('movedProjectIds', () => {
  it('makes the target primary and keeps the other repos', () => {
    expect(movedProjectIds(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(movedProjectIds(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(movedProjectIds(['a', 'b'], null)).toEqual([]);
    expect(movedProjectIds(['1', '2', '3', '4', '5', '6', '7', '8'], 'x')).toHaveLength(8);
  });
});

describe('pinned order', () => {
  const pinned = (id: string, at: string, order: number | null = null, projectIds: string[] = []) =>
    chat(id, { pinnedAt: `2026-09-26T0${at}:00:00.000Z`, pinnedOrder: order, projectIds });

  it('puts new pins on top, then the manual order, then unpinned chats', () => {
    const sorted = pinnedFirst([
      chat('loose'),
      pinned('second', '1', 2),
      pinned('first', '2', 1),
      pinned('fresh', '3'),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['fresh', 'first', 'second', 'loose']);
  });

  it('lists pinned siblings in the same group and moves one step at a time', () => {
    const chats = [
      pinned('a', '1', 1),
      pinned('b', '2', 2),
      pinned('c', '3', 1, ['web']),
      chat('d'),
    ];
    expect(pinnedSiblings(chats, chats[1]!)).toEqual(['a', 'b']);
    expect(movedOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(movedOrder(['a', 'b'], 'a', -1)).toBeNull();
    expect(movedOrder(['a', 'b'], 'b', 1)).toBeNull();
  });
});
