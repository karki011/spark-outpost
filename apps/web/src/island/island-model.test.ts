import { describe, expect, it } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import {
  hoverOpensHome,
  islandView,
  newMoments,
  panelWidth,
  nextStreak,
  pendingCards,
  quickShortcutTarget,
  viewWidth,
  runStatuses,
  sessionState,
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

function terminal(id: string, state: string, patch: Partial<ConversationSummary> = {}) {
  return chat(id, {
    sessionType: 'terminal',
    terminal: {
      id: `session-${id}`,
      conversationId: id,
      provider: 'claude',
      state,
      cwd: '/Users/ada/code/shop',
      label: 'shop',
      updatedAt: '2026-09-30T10:05:00.000Z',
      resumeAvailable: false,
      runId: null,
      observation: 'hooks',
      reason: null,
      agentMode: null,
    } as NonNullable<ConversationSummary['terminal']>,
    ...patch,
  });
}

const quiet: IslandInputs = {
  note: false,
  panel: null,
  cards: [],
  review: null,
  hoverLine: false,
};

const resting = { waiting: 0, hour: 14, idleMinutes: 0, running: 0, moment: null, failed: false };

describe('island state machine', () => {
  it('rests as Scout alone, where hover opens the panel unless a top item has a line', () => {
    const card = { kind: 'approval' as const, chat: chat('a'), approval: null, loading: false };
    expect(islandView(quiet)).toEqual({ kind: 'peek' });
    expect(islandView({ ...quiet, cards: [card] })).toEqual({ kind: 'peek' });
    expect(hoverOpensHome(islandView(quiet), false)).toBe(true);
    expect(hoverOpensHome(islandView({ ...quiet, cards: [card] }), true)).toBe(false);
    expect(hoverOpensHome(islandView({ ...quiet, panel: 'quick' }), false)).toBe(false);
    expect(hoverOpensHome(islandView({ ...quiet, note: true }), false)).toBe(false);
    expect(
      hoverOpensHome(islandView({ ...quiet, cards: [card], review: card.chat.id }), false),
    ).toBe(false);
    expect(scoutMoodFor(islandView(quiet), { ...resting, waiting: 1 })).toBe('alert');
    expect(scoutMoodFor(islandView(quiet), { ...resting, running: 2 })).toBe('working');
  });

  it('shows the top item as one line only while hovered', () => {
    const card = { kind: 'approval' as const, chat: chat('a'), approval: null, loading: false };
    const line = islandView({ ...quiet, cards: [card], hoverLine: true });
    expect(line).toEqual({ kind: 'now' });
    expect(hoverOpensHome(line, true)).toBe(false);
    expect(quickShortcutTarget(null, line, card)).toEqual({ kind: 'review', chatId: 'a' });
    expect(quickShortcutTarget(null, line)).toEqual({ kind: 'quick' });
    expect(islandView({ ...quiet, cards: [card], hoverLine: true, review: 'a' }).kind).toBe('card');
    expect(islandView({ ...quiet, hoverLine: true, panel: 'home' }).kind).toBe('panel');
  });

  it('keeps the hover line clear of the notch and the rest as wide as the notch', () => {
    expect(viewWidth({ kind: 'now' }, 0, 1512)).toBe(460);
    expect(viewWidth({ kind: 'now' }, 400, 1512)).toBe(608);
    expect(viewWidth({ kind: 'peek' }, 186, 1512)).toBe(186);
    expect(viewWidth({ kind: 'peek' }, 0, 1512)).toBe(72);
  });

  it('opens a waiting card on review', () => {
    const first = { kind: 'approval' as const, chat: chat('a'), approval: null, loading: false };
    const second = { kind: 'question' as const, chat: chat('b'), approval: null, loading: false };
    const cards = [first, second];
    expect(islandView({ ...quiet, cards, review: second.chat.id })).toEqual({
      kind: 'card',
      card: second,
      index: 2,
      total: 2,
    });
    expect(islandView({ ...quiet, cards, review: 'gone' }).kind).toBe('peek');
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

  it('notices a Terminal turn that went from working to ready, once', () => {
    const before = runStatuses([terminal('t', 'working'), terminal('u', 'starting')]);
    const after = [terminal('t', 'ready'), terminal('u', 'ready')];
    expect(newMoments(before, after)).toEqual([{ kind: 'done', chatId: 't', runId: 'session-t' }]);
    expect(newMoments(runStatuses(after), after)).toEqual([]);
    const asking = [terminal('t', 'waiting_for_permission')];
    expect(newMoments(before, asking)).toEqual([]);
  });

  it('gives a Terminal turn with a run one moment, from the run', () => {
    const before = runStatuses([terminal('t', 'working', { latestRun: run('r1', 'running') })]);
    const stillOpen = [terminal('t', 'ready', { latestRun: run('r1', 'running') })];
    expect(newMoments(before, stillOpen)).toEqual([]);
    const closed = [terminal('t', 'ready', { latestRun: run('r1', 'succeeded') })];
    expect(newMoments(before, closed)).toEqual([{ kind: 'done', chatId: 't', runId: 'r1' }]);
    expect(newMoments(runStatuses(stillOpen), closed)).toEqual([
      { kind: 'done', chatId: 't', runId: 'r1' },
    ]);
  });

  it('calls a ready Terminal session done after a finished turn', () => {
    expect(sessionState(terminal('t', 'ready', { latestRun: run('r1', 'succeeded') }))).toBe(
      'done',
    );
    expect(sessionState(terminal('t', 'ready'))).toBe('idle');
    expect(sessionState(terminal('t', 'working', { latestRun: run('r1', 'succeeded') }))).toBe(
      'working',
    );
    expect(sessionState(terminal('t', 'exited', { latestRun: run('r1', 'succeeded') }))).toBe(
      'idle',
    );
  });

  it('queues pending approvals oldest first', () => {
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
    const cards = pendingCards(chats, approvals);
    expect(cards.map((card) => [card.chat.id, card.kind])).toEqual([
      ['b', 'force'],
      ['a', 'approval'],
    ]);

    const two = new Map([
      ['a', [approval('p0', '2026-09-30T10:00:00Z'), approval('p1', '2026-09-30T10:05:00Z')]],
    ]);
    const putOff = (id: string) => id === 'p1';
    expect(pendingCards([chats[0]!], two, putOff)[0]!.approval!.id).toBe('p0');
    expect(pendingCards([chats[0]!], two, () => true)[0]!.approval!.id).toBe('p1');
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

describe('panel width', () => {
  it('grows with the screen between a floor and a ceiling', () => {
    expect([1280, 1512, 1728, 1920, 3008].map((screen) => panelWidth('home', screen))).toEqual([
      640, 640, 726, 760, 760,
    ]);
    expect([1280, 1728, 1920].map((screen) => panelWidth('quick', screen))).toEqual([
      640, 726, 760,
    ]);
    expect(panelWidth('quick', 1920)).toBe(panelWidth('ask', 1920));
  });
});
