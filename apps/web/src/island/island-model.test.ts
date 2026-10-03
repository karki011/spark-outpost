import { describe, expect, it } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { fastAnswer } from './ask-fast-path.ts';
import {
  cardKey,
  hoverOpens,
  islandView,
  newMoments,
  nextStreak,
  peekOffset,
  peekRow,
  pendingCards,
  runStatuses,
  type IslandInputs,
} from './island-model.ts';
import { crewQuirk, scoutMoodFor } from './island-mood.ts';

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

const run = (id: string, status: string) =>
  ({
    id,
    status,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
  }) as ConversationSummary['latestRun'];

const quiet: IslandInputs = {
  note: false,
  panel: null,
  cards: [],
  review: null,
  nudge: false,
};

describe('island state machine', () => {
  it('rests whatever is running or waiting, and hovering opens the full panel', () => {
    const card = { kind: 'approval' as const, chat: chat('a'), approval: null };
    expect(islandView(quiet).kind).toBe('peek');
    expect(islandView({ ...quiet, cards: [card] }).kind).toBe('peek');
    expect(hoverOpens(islandView(quiet))).toEqual({ kind: 'home' });
    expect(hoverOpens(islandView({ ...quiet, cards: [card], nudge: true }))).toEqual({
      kind: 'card',
      card,
    });
    expect(hoverOpens(islandView({ ...quiet, panel: 'quick' }))).toBeNull();
    expect(hoverOpens(islandView({ ...quiet, note: true }))).toBeNull();
    expect(hoverOpens(islandView({ ...quiet, cards: [card], review: cardKey(card) }))).toBeNull();
  });

  it('nudges for a waiting card only when allowed, and opens it on review', () => {
    const first = { kind: 'approval' as const, chat: chat('a'), approval: null };
    const second = { kind: 'question' as const, chat: chat('b'), approval: null };
    const cards = [first, second];
    expect(islandView({ ...quiet, cards, nudge: true })).toEqual({
      kind: 'nudge',
      card: first,
      total: 2,
    });
    expect(islandView({ ...quiet, cards, review: cardKey(second) })).toEqual({
      kind: 'card',
      card: second,
      index: 2,
      total: 2,
    });
    expect(islandView({ ...quiet, cards, review: 'gone' }).kind).toBe('peek');
    expect(islandView({ ...quiet, cards, nudge: true, panel: 'sessions' }).kind).toBe('panel');
    expect(islandView({ ...quiet, panel: 'quick', note: true }).kind).toBe('note');
  });

  it('notices runs that just finished or failed, and counts a streak', () => {
    const before = runStatuses([
      chat('a', { latestRun: run('r1', 'running') }),
      chat('b', { latestRun: run('r2', 'running') }),
    ]);
    const after = [
      chat('a', { latestRun: run('r1', 'succeeded') }),
      chat('b', { latestRun: run('r2', 'failed') }),
    ];
    const moments = newMoments(before, after);
    expect(moments.map((moment) => moment.kind)).toEqual(['done', 'failed']);
    expect(newMoments(runStatuses(after), after)).toEqual([]);
    expect(nextStreak(nextStreak(2, moments[0]!), moments[0]!)).toBe(4);
    expect(nextStreak(4, moments[1]!)).toBe(0);
  });

  it('queues pending approvals oldest first and skips snoozed ones', () => {
    const approval = (id: string, createdAt: string, forcePush?: string[]) =>
      ({
        id,
        status: 'pending',
        createdAt,
        payload: {
          command: 'git push',
          cwd: null,
          paths: [],
          diffs: [],
          truncated: false,
          ...(forcePush ? { forcePush } : {}),
        },
      }) as unknown as Approval;
    const attention = (approvalId: string) => ({
      kind: 'permission' as const,
      title: 'run',
      agentName: null,
      provider: null,
      approvalId,
    });
    const chats = [
      chat('a', { needsInput: true, attention: attention('p1') }),
      chat('b', { needsInput: true, attention: attention('p2') }),
    ];
    const approvals = new Map([
      ['a', [approval('p1', '2026-09-30T10:05:00Z')]],
      ['b', [approval('p2', '2026-09-30T10:01:00Z', ['main'])]],
    ]);
    const cards = pendingCards(chats, approvals, new Set());
    expect(cards.map((card) => [card.chat.id, card.kind])).toEqual([
      ['b', 'force'],
      ['a', 'approval'],
    ]);
    expect(pendingCards(chats, approvals, new Set(['p2'])).map((card) => card.chat.id)).toEqual([
      'a',
    ]);
  });

  it('picks up to five recently active sessions for the peek row, spread around Scout', () => {
    const now = Date.parse('2026-09-30T10:30:00Z');
    const chats = Array.from({ length: 7 }, (_, index) =>
      chat(`c${index}`, { updatedAt: new Date(now - index * 60_000).toISOString() }),
    );
    chats.push(chat('stale', { updatedAt: '2026-09-30T09:00:00Z' }));
    const row = peekRow(chats, new Set(['c6']), now);
    expect(row.sessions.map((session) => session.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(row.more).toBe(1);
    expect([0, 1, 2, 3, 4].map(peekOffset)).toEqual([30, -30, 56, -56, 82]);
  });
});

describe('moods and quirks', () => {
  const context = {
    waiting: 0,
    hour: 14,
    idleMinutes: 0,
    running: 0,
    moment: null,
    failed: false,
  };

  it('shows what is happening on the resting blob, sleepy late at night', () => {
    const peek = { kind: 'peek' } as const;
    const moment = { kind: 'done' as const, chatId: 'a', runId: 'r' };
    expect(scoutMoodFor(peek, context)).toBeNull();
    expect(scoutMoodFor(peek, { ...context, running: 2 })).toBe('working');
    expect(scoutMoodFor(peek, { ...context, waiting: 1, running: 2 })).toBe('alert');
    expect(scoutMoodFor(peek, { ...context, moment, running: 1 })).toBe('happy');
    expect(scoutMoodFor(peek, { ...context, moment: { ...moment, kind: 'failed' } })).toBe('sad');
    expect(scoutMoodFor(peek, { ...context, failed: true })).toBe('sad');
    expect(scoutMoodFor(peek, { ...context, hour: 1 })).toBe('sleep');
    expect(scoutMoodFor({ kind: 'panel', panel: 'quick' }, { ...context, running: 1 })).toBeNull();
  });

  it('gives each role a quirk and reacts to checks and questions', () => {
    expect(
      crewQuirk({
        role: 'builder',
        state: 'working',
        step: 'Editing upload.ts',
        checksPassed: false,
      }),
    ).toBe('focused');
    expect(
      crewQuirk({
        role: 'builder',
        state: 'working',
        step: 'Running pnpm test',
        checksPassed: false,
      }),
    ).toBe('nervous');
    expect(crewQuirk({ role: 'critic', state: 'done', step: null, checksPassed: true })).toBe(
      'relieved',
    );
    expect(crewQuirk({ role: 'scout', state: 'waiting', step: null, checksPassed: false })).toBe(
      'tilt',
    );
    expect(
      crewQuirk({ role: 'scout', state: 'working', step: 'Reading', checksPassed: false }),
    ).toBe('peer');
  });
});

describe('Ask Spark fast path', () => {
  const state = {
    waiting: [{ id: 'a', title: 'Deploy the site', detail: 'wants to run pnpm deploy' }],
    running: [],
    spendToday: 1.24,
  };

  it('answers the common questions from Spark’s own state', () => {
    expect(fastAnswer('Does anyone need anything?', state)).toEqual({
      text: '1 chat needs you: “Deploy the site”.',
      chats: state.waiting,
    });
    expect(fastAnswer('what’s running?', state)?.text).toBe('Nothing is running right now.');
    expect(fastAnswer('What did I spend today?', state)?.text).toBe('You’ve spent $1.24 today.');
  });

  it('leaves anything else to the model', () => {
    expect(fastAnswer('How is the upload chat going?', state)).toBeNull();
    expect(fastAnswer('What did I spend last week?', state)).toBeNull();
    expect(fastAnswer('Which provider is cheapest?', state)).toBeNull();
  });
});
