import { describe, expect, it } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { fastAnswer } from './ask-fast-path.ts';
import {
  hoverOpens,
  islandView,
  newMoments,
  chatWidth,
  panelWidth,
  nextStreak,
  peekClearance,
  peekOffset,
  peekRow,
  pendingCards,
  quickShortcutTarget,
  viewWidth,
  runStatuses,
  sessionState,
  type Card,
  type IslandInputs,
} from './island-model.ts';
import { crewQuirk, scoutMoodFor, sessionExpression } from './island-mood.ts';

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

const resting = { waiting: 0, hour: 14, idleMinutes: 0, running: 0, moment: null, failed: false };

describe('island state machine', () => {
  it('rests whatever is running or waiting, and hovering opens the full panel', () => {
    const card = { kind: 'approval' as const, chat: chat('a'), approval: null, loading: false };
    expect(islandView(quiet).kind).toBe('peek');
    expect(islandView({ ...quiet, cards: [card] }).kind).toBe('peek');
    expect(hoverOpens(islandView(quiet))).toEqual({ kind: 'home' });
    expect(hoverOpens(islandView({ ...quiet, cards: [card], nudge: true }))).toEqual({
      kind: 'card',
      card,
    });
    expect(hoverOpens(islandView({ ...quiet, panel: 'quick' }))).toBeNull();
    expect(hoverOpens(islandView({ ...quiet, note: true }))).toBeNull();
    expect(hoverOpens(islandView({ ...quiet, cards: [card], review: card.chat.id }))).toBeNull();
  });

  it('rests as blobs alone at every size while one chat works, narrower than any row', () => {
    const working = chat('a', { latestRun: run('r1', 'running') });
    const row = peekRow([working], new Set(), Date.parse(working.updatedAt));
    expect(row.sessions.map((session) => session.id)).toEqual(['a']);
    for (const full of [true, false]) {
      const view = islandView({ ...quiet, hoverOnly: true, full });
      expect(view).toEqual({ kind: 'peek' });
      expect(viewWidth(view, 0, 1440)).toBeLessThan(
        viewWidth({ kind: 'now', card: null }, 0, 1440),
      );
      expect(viewWidth(view, 186, 1440)).toBe(186);
    }
  });

  it('stays collapsed in hover-only mode even with Full size and pending requests', () => {
    const card = { kind: 'approval' as const, chat: chat('a'), approval: null, loading: false };
    const inputs = { ...quiet, hoverOnly: true, full: true, cards: [card], nudge: true };
    expect(islandView(inputs)).toEqual({ kind: 'peek' });
    expect(hoverOpens(islandView(inputs))).toEqual({ kind: 'home' });
    expect(hoverOpens(islandView(inputs), card)).toEqual({ kind: 'card', card });
    expect(quickShortcutTarget(null, islandView(inputs), card)).toEqual({
      kind: 'review',
      chatId: 'a',
    });
    expect(islandView({ ...inputs, panel: 'sessions' }).kind).toBe('panel');
    expect(islandView({ ...inputs, review: 'a' }).kind).toBe('card');
  });

  it('rests as the full bar at Full size, carrying the request instead of a pill', () => {
    const card = { kind: 'approval' as const, chat: chat('a'), approval: null, loading: false };
    const full = { ...quiet, full: true };
    expect(islandView(full)).toEqual({ kind: 'now', card: null });
    expect(islandView({ ...full, cards: [card] })).toEqual({ kind: 'now', card: null });
    const asking = islandView({ ...full, cards: [card], nudge: true });
    expect(asking).toEqual({ kind: 'now', card });
    expect(hoverOpens(asking)).toEqual({ kind: 'card', card });
    expect(hoverOpens(islandView(full))).toEqual({ kind: 'home' });
    expect(quickShortcutTarget(null, asking)).toEqual({ kind: 'review', chatId: 'a' });
    expect(quickShortcutTarget(null, islandView(full))).toEqual({ kind: 'quick' });
    expect(islandView({ ...full, cards: [card], review: 'a' }).kind).toBe('card');
    expect(islandView({ ...full, panel: 'home' }).kind).toBe('panel');
    expect(scoutMoodFor(asking, { ...resting, running: 2 })).toBe('alert');
    expect(scoutMoodFor(islandView(full), { ...resting, running: 2 })).toBe('working');
  });

  it('keeps the full bar clear of the notch and the resting strip as wide as the notch', () => {
    expect(viewWidth({ kind: 'now', card: null }, 0, 1512)).toBe(400);
    expect(viewWidth({ kind: 'now', card: null }, 238, 1512)).toBe(446);
    expect(viewWidth({ kind: 'peek' }, 186, 1512)).toBe(186);
    expect(viewWidth({ kind: 'peek' }, 0, 1512)).toBe(72);
  });

  it('nudges for a waiting card only when allowed, and opens it on review', () => {
    const first = { kind: 'approval' as const, chat: chat('a'), approval: null, loading: false };
    const second = { kind: 'question' as const, chat: chat('b'), approval: null, loading: false };
    const cards = [first, second];
    expect(islandView({ ...quiet, cards, nudge: true })).toEqual({
      kind: 'nudge',
      card: first,
      total: 2,
    });
    expect(islandView({ ...quiet, cards, review: second.chat.id })).toEqual({
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
    expect([0, 1, 2, 3, 4].map((slot) => peekOffset(slot, 38))).toEqual([38, -38, 64, -64, 90]);
  });

  it('keeps the peek row clear of a bigger hanging Spark and its badge', () => {
    const flatEdge = (blob: number) => peekClearance(true, blob) * 1.25 - 14 - 4;
    for (const blob of [38, 48, 58]) {
      expect(flatEdge(blob)).toBeGreaterThanOrEqual(blob / 2 + 8);
    }
    expect(peekClearance(true, 58)).toBeGreaterThan(peekClearance(true, 38));
    expect(peekClearance(false, 58)).toBe(peekClearance(false, 38));
  });

  it('reads each chat as working, waiting, done, failed or quiet', () => {
    const latest = (status: string) => ({ latestRun: run('r', status) });
    expect(sessionState(chat('a', latest('running')))).toBe('working');
    expect(sessionState(chat('b', { ...latest('awaiting_approval'), needsInput: true }))).toBe(
      'waiting',
    );
    expect(sessionState(chat('c', latest('succeeded')))).toBe('done');
    expect(sessionState(chat('d', latest('failed')))).toBe('failed');
    expect(sessionState(chat('e'))).toBe('idle');
  });

  it('gives each chat state its own face, sleepy only when quiet at night', () => {
    expect(sessionExpression('working', true)).toBe('thinking');
    expect(sessionExpression('waiting', false)).toBe('unsure');
    expect(sessionExpression('done', false)).toBe('happy');
    expect(sessionExpression('failed', true)).toBe('sad');
    expect(sessionExpression('idle', false)).toBe('idle');
    expect(sessionExpression('idle', true)).toBe('sleepy');
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

  describe('the quick shortcut target', () => {
    const waiting = chat('a', { needsInput: true });
    const loadingCard: Card = {
      kind: 'open' as const,
      chat: waiting,
      approval: null,
      loading: true,
    };
    const approvalCard: Card = {
      kind: 'approval' as const,
      chat: waiting,
      approval: null,
      loading: false,
    };
    const openCard: Card = { kind: 'open' as const, chat: waiting, approval: null, loading: false };
    const nudge = (card: Card) => ({ kind: 'nudge' as const, card, total: 1 });
    const reviewCard = (card: Card) => ({
      kind: 'card' as const,
      card,
      index: 1,
      total: 1,
    });

    it('reviews a needs-you item whose details are still loading instead of starting a chat', () => {
      expect(quickShortcutTarget(null, nudge(loadingCard))).toEqual({
        kind: 'review',
        chatId: 'a',
      });
      expect(quickShortcutTarget(null, reviewCard(loadingCard))).toEqual({
        kind: 'review',
        chatId: 'a',
      });
    });

    it('reviews a loaded approval and keeps its chat id when the details arrive', () => {
      expect(quickShortcutTarget(null, nudge(approvalCard))).toEqual({
        kind: 'review',
        chatId: 'a',
      });
    });

    it('opens the composer when nothing needs approving and closes an open panel', () => {
      expect(quickShortcutTarget(null, { kind: 'peek' })).toEqual({ kind: 'quick' });
      expect(quickShortcutTarget(null, nudge(openCard))).toEqual({ kind: 'quick' });
      expect(quickShortcutTarget('home', nudge(loadingCard))).toEqual({ kind: 'close' });
    });
  });
});

describe('panel width', () => {
  it('grows with the screen between a floor and a ceiling', () => {
    expect([1280, 1512, 1728, 1920, 3008].map((screen) => panelWidth('home', screen))).toEqual([
      720, 756, 864, 920, 920,
    ]);
    expect([1280, 1728, 1920].map((screen) => panelWidth('quick', screen))).toEqual([
      640, 726, 760,
    ]);
    expect(panelWidth('sessions', 1920)).toBe(panelWidth('ask', 1920));
  });

  it('never narrows an open chat below its reading width', () => {
    expect(chatWidth(1280)).toBe(690);
    expect(chatWidth(1920)).toBe(760);
  });
});
