import { describe, expect, it } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { fastAnswer } from './ask-fast-path.ts';
import {
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
  moment: null,
  running: 0,
  hover: false,
};

describe('island state machine', () => {
  it('peeks when quiet, pops into a pill on hover, and shows the live row while work runs', () => {
    expect(islandView(quiet).kind).toBe('peek');
    expect(islandView({ ...quiet, hover: true }).kind).toBe('pill');
    expect(islandView({ ...quiet, running: 2 }).kind).toBe('live');
    expect(islandView({ ...quiet, running: 2, hover: true }).kind).toBe('overview');
  });

  it('puts cards above moments and work, and the user’s own panel above cards', () => {
    const card = { kind: 'approval' as const, chat: chat('a'), approval: null };
    const moment = { kind: 'done' as const, chatId: 'b', runId: 'r' };
    expect(islandView({ ...quiet, running: 1, moment, cards: [card, card] })).toEqual({
      kind: 'card',
      card,
      index: 1,
      total: 2,
    });
    expect(islandView({ ...quiet, running: 1, moment }).kind).toBe('moment');
    expect(islandView({ ...quiet, cards: [card], panel: 'sessions' }).kind).toBe('panel');
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
  const context = { waiting: 0, hour: 14, idleMinutes: 0 };

  it('maps what is happening to Scout’s mood, sleepy late at night', () => {
    expect(scoutMoodFor({ kind: 'live' }, context)).toBe('working');
    expect(scoutMoodFor({ kind: 'peek' }, { ...context, waiting: 1 })).toBe('alert');
    expect(scoutMoodFor({ kind: 'peek' }, { ...context, hour: 1 })).toBe('sleep');
    expect(
      scoutMoodFor(
        { kind: 'moment', moment: { kind: 'failed', chatId: 'a', runId: 'r' } },
        context,
      ),
    ).toBe('sad');
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
