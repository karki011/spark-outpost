import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { needsYou, progressPercent, recentChats, runningNow, summaryParts } from './home-model.ts';

let next = 0;

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    title: `Chat ${next}`,
    updatedAt: `2026-09-26T10:${String(next).padStart(2, '0')}:00.000Z`,
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
  };
}

function run(status: string, extra: Partial<NonNullable<ConversationSummary['latestRun']>> = {}) {
  return {
    id: '00000000-0000-4000-8000-00000000aaaa',
    status,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
    ...extra,
  } as ConversationSummary['latestRun'];
}

const asking = (title: string) =>
  chat({
    title,
    needsInput: true,
    latestRun: run('awaiting_approval'),
    attention: {
      kind: 'permission',
      title: 'run pnpm test',
      agentName: null,
      provider: 'codex',
      approvalId: '00000000-0000-4000-8000-00000000bbbb',
    },
  });
const failed = (title: string) =>
  chat({ title, latestRun: run('failed', { error: 'Rate limit reached.' }) });
const finished = (title: string) => chat({ title, unread: true, latestRun: run('succeeded') });
const working = (title: string, extra = {}) => chat({ title, latestRun: run('running', extra) });

describe('summaryParts', () => {
  const text = (chats: ConversationSummary[]) =>
    summaryParts(chats, needsYou(chats).length, 'All quiet. Start something new below.')
      .map((part) => part.text)
      .join('');

  it('is quiet when nothing runs or waits', () => {
    expect(text([chat()])).toBe('All quiet. Start something new below.');
  });

  it('counts everything that needs you, then working agents, in the right number', () => {
    expect(text([working('A')])).toBe('1 agent is working.');
    expect(text([working('A'), working('B'), asking('C')])).toBe(
      '1 thing needs you and 2 agents are working.',
    );
    expect(text([asking('A'), finished('B')])).toBe('2 things need you.');
    const parts = summaryParts([working('A'), asking('B')], 1, '');
    expect(parts.filter((part) => part.strong)).toHaveLength(2);
    expect(parts.filter((part) => part.link).map((part) => part.text)).toEqual([
      '1 thing needs you',
    ]);
  });

  it('ignores archived chats', () => {
    expect(text([{ ...asking('A'), archivedAt: '2026-09-26T10:00:00.000Z' }])).toBe(
      'All quiet. Start something new below.',
    );
  });
});

describe('needsYou', () => {
  it('orders asking, then errors, then finished chats, with their action and mood', () => {
    const items = needsYou([
      finished('Done'),
      failed('Broken'),
      working('Busy'),
      asking('Waiting'),
      chat({ title: 'Idle' }),
    ]);
    expect(items.map((item) => [item.chat.title, item.action, item.expression])).toEqual([
      ['Waiting', 'Answer', 'unsure'],
      ['Broken', 'See error', 'sad'],
      ['Done', 'Review', 'happy'],
    ]);
    expect(items[0]).toMatchObject({ provider: 'codex', sub: 'Codex wants to run pnpm test' });
    expect(items[1]!.sub).toBe('Stopped: rate limit reached');
    expect(items[2]!.sub).toBe('Finished · open to review');
  });

  it('keeps the list order within each group', () => {
    const items = needsYou([failed('First'), asking('Ask'), failed('Second')]);
    expect(items.map((item) => item.chat.title)).toEqual(['Ask', 'First', 'Second']);
  });
});

describe('progressPercent', () => {
  it('counts finished steps and half of the one in progress', () => {
    expect(progressPercent({ done: 2, active: 1, total: 5 })).toBe(50);
    expect(progressPercent({ done: 4, active: 0, total: 4 })).toBe(100);
  });

  it('shows a sliver at the start and nothing without a plan', () => {
    expect(progressPercent({ done: 0, active: 0, total: 6 })).toBe(4);
    expect(progressPercent(null)).toBeNull();
  });
});

describe('runningNow and recentChats', () => {
  it('lists working chats with their step and progress, but not ones waiting on you', () => {
    const items = runningNow([
      working('Busy', { step: 'Reading files', progress: { done: 1, active: 1, total: 3 } }),
      chat({ title: 'Queued', latestRun: run('queued') }),
      asking('Waiting'),
    ]);
    expect(items.map((item) => [item.chat.title, item.step, item.percent])).toEqual([
      ['Busy', 'Reading files', 50],
      ['Queued', 'Waiting to start', null],
    ]);
  });

  it('shows up to five other active chats, newest first', () => {
    const shown = asking('Shown');
    const others = Array.from({ length: 7 }, (_, index) => chat({ title: `Other ${index}` }));
    const archived = chat({ title: 'Old', archivedAt: '2026-09-26T10:00:00.000Z' });
    const recent = recentChats([shown, ...others, archived], [shown]);
    expect(recent.map((item) => item.title)).toEqual([
      'Other 6',
      'Other 5',
      'Other 4',
      'Other 3',
      'Other 2',
    ]);
  });
});
