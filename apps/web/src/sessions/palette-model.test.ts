import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import {
  isPaletteShortcut,
  matchesEntry,
  moveActive,
  paletteEntries,
  paletteEntry,
  paletteSections,
} from './palette-model.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PROJECT = uuid(900);
const NAMES = new Map([[PROJECT, 'Shop']]);

function chat(n: number, patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: uuid(n),
    title: `Chat ${n}`,
    updatedAt: `2026-10-02T12:${String(n).padStart(2, '0')}:00.000Z`,
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

const run = (n: number, status: string, patch: object = {}) =>
  ({
    id: uuid(n),
    status,
    error: null,
    step: null,
    provider: 'codex',
    progress: null,
    ...patch,
  }) as ConversationSummary['latestRun'];

function terminal(n: number, state: string, patch: Partial<ConversationSummary> = {}) {
  return chat(n, {
    sessionType: 'terminal',
    terminal: {
      id: uuid(n),
      conversationId: uuid(n),
      provider: 'claude',
      state,
      cwd: '/Users/ada/code/feature-web',
      label: 'feature-web',
      updatedAt: '2026-10-02T12:30:00.000Z',
      resumeAvailable: false,
      runId: null,
      observation: 'hooks',
      reason: null,
      agentMode: null,
    } as NonNullable<ConversationSummary['terminal']>,
    ...patch,
  });
}

const titles = (chats: readonly ConversationSummary[], found: ConversationSummary[], q: string) =>
  paletteEntries(chats, found, NAMES, q).map((entry) => entry.chat.title);

describe('palette order', () => {
  const chats = [
    chat(1, { title: 'Old idle' }),
    chat(2, { title: 'Running chat', latestRun: run(20, 'running', { step: 'Reading' }) }),
    terminal(3, 'waiting_for_permission', { title: 'Terminal asks' }),
    terminal(4, 'working', { title: 'Terminal runs' }),
    chat(5, { title: 'New idle', projectIds: [PROJECT] }),
    chat(6, { title: 'Chat asks', needsInput: true, latestRun: run(60, 'running') }),
    chat(7, { title: 'Put away', archivedAt: '2026-10-02T13:00:00.000Z' }),
  ];

  it('puts sessions that need you first, then working, then the rest by recency', () => {
    expect(titles(chats, [], '')).toEqual([
      'Chat asks',
      'Terminal asks',
      'Terminal runs',
      'Running chat',
      'New idle',
      'Old idle',
    ]);
  });

  it('groups the ordered rows under one heading each and keeps a running index', () => {
    const sections = paletteSections(paletteEntries(chats, [], NAMES, ''));
    expect(sections.map((section) => [section.group, section.entries.length])).toEqual([
      ['needs', 2],
      ['working', 2],
      ['recent', 2],
    ]);
    expect(sections.flatMap((section) => section.entries.map((item) => item.index))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('filters by title, project, folder, provider, Terminal and state', () => {
    expect(titles(chats, [], 'new')).toEqual(['New idle']);
    expect(titles(chats, [], 'SHOP')).toEqual(['New idle']);
    expect(titles(chats, [], 'feature-web')).toEqual(['Terminal asks', 'Terminal runs']);
    expect(titles(chats, [], 'codex')).toEqual(['Chat asks', 'Running chat']);
    expect(titles(chats, [], 'terminal claude')).toEqual(['Terminal asks', 'Terminal runs']);
    expect(titles(chats, [], 'waiting for permission')).toEqual(['Terminal asks']);
    expect(titles(chats, [], 'running')).toEqual(['Terminal runs', 'Running chat']);
    expect(titles(chats, [], 'needs you')).toEqual(['Chat asks', 'Terminal asks']);
    expect(titles(chats, [], 'nothing like this')).toEqual([]);
  });

  it('finds archived chats only when a query is typed', () => {
    expect(titles(chats, [], 'put away')).toEqual(['Put away']);
    expect(paletteEntry(chats[6]!, NAMES).label).toBe('Archived');
  });

  it('adds server matches once, keeping the live copy of a loaded chat', () => {
    const stale = { ...chats[1]!, latestRun: run(20, 'succeeded') };
    const older = chat(40, { title: 'From last year', updatedAt: '2025-01-01T00:00:00.000Z' });
    const entries = paletteEntries(chats, [stale, older, older], NAMES, 'last year');
    expect(entries.map((entry) => [entry.chat.title, entry.group])).toEqual([
      ['Running chat', 'working'],
      ['From last year', 'recent'],
    ]);
  });

  it('keeps the server snippet and orders each group by search rank', () => {
    const match = (n: number) => ({
      messageId: uuid(100 + n),
      runId: null,
      parts: [{ text: `hit ${n}`, match: true }],
    });
    const loaded = [chat(1, { title: 'Alpha' }), chat(2, { title: 'Beta' })];
    const found = [chat(1, { match: match(1) }), chat(2, { match: match(2) })];
    const entries = paletteEntries(loaded, found, NAMES, 'hit');
    expect(entries.map((entry) => [entry.chat.title, entry.chat.match?.parts[0]?.text])).toEqual([
      ['Alpha', 'hit 1'],
      ['Beta', 'hit 2'],
    ]);
  });
});

describe('palette rows', () => {
  it('names the place, the agent and the state', () => {
    expect(paletteEntry(terminal(1, 'ready'), NAMES)).toMatchObject({
      place: 'feature-web',
      agent: 'Claude · Terminal',
      label: 'Idle',
    });
    expect(paletteEntry(chat(2, { projectIds: [PROJECT] }), NAMES)).toMatchObject({
      place: 'Shop',
      agent: '',
      label: 'Idle',
    });
    expect(matchesEntry(paletteEntry(chat(3), NAMES), '  ')).toBe(true);
  });
});

describe('palette keys', () => {
  it('moves through the rows and wraps at both ends', () => {
    expect(moveActive(0, 'ArrowDown', 3)).toBe(1);
    expect(moveActive(2, 'ArrowDown', 3)).toBe(0);
    expect(moveActive(0, 'ArrowUp', 3)).toBe(2);
    expect(moveActive(5, 'x', 3)).toBe(2);
    expect(moveActive(4, 'ArrowDown', 0)).toBe(0);
  });

  it('opens on the modifier with Shift and K only', () => {
    const key = (patch: object) => ({
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      key: 'k',
      ...patch,
    });
    expect(isPaletteShortcut(key({ metaKey: true, shiftKey: true, key: 'K' }), true)).toBe(true);
    expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isPaletteShortcut(key({ metaKey: true }), true)).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }), true)).toBe(false);
    expect(isPaletteShortcut(key({ metaKey: true, shiftKey: true, altKey: true }), true)).toBe(
      false,
    );
  });
});
