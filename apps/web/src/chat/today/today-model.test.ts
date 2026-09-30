import { describe, expect, it } from 'vitest';
import type { TodayChat, TodaySummary } from '@spark-outpost/contracts';
import { chatExpression, chatNote, todayStats } from './today-model.ts';

const CHAT: TodayChat = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Fix login',
  project: 'app',
  state: 'finished',
  kept: 0,
  prs: 0,
  tickets: 0,
  updatedAt: '2026-09-30T10:00:00.000Z',
};

function summary(overrides: Partial<TodaySummary> = {}): TodaySummary {
  return {
    since: '2026-09-30T00:00:00.000Z',
    chats: 1,
    waiting: 0,
    kept: 0,
    prs: 0,
    tickets: 0,
    costUsd: null,
    costSource: null,
    recent: [CHAT],
    ...overrides,
  };
}

const text = (value: TodaySummary) =>
  todayStats(value).map((stat) => `${stat.count} ${stat.label}`);

describe('todayStats', () => {
  it('lists only what happened, in plain words', () => {
    expect(
      text(
        summary({
          chats: 3,
          waiting: 1,
          kept: 2,
          prs: 1,
          tickets: 2,
          costUsd: 1.234,
          costSource: 'reported',
        }),
      ),
    ).toEqual(['3 chats', '1 need you', '2 changes kept', '1 PR', '2 tickets', '$1.23 spent']);
    expect(text(summary())).toEqual(['1 chat']);
  });

  it('flags chats waiting on you and marks estimated spend', () => {
    const stats = todayStats(summary({ waiting: 2, costUsd: 0.5, costSource: 'estimated' }));
    expect(stats.find((stat) => stat.key === 'waiting')?.attention).toBe(true);
    expect(stats.at(-1)).toMatchObject({ count: '~$0.50', label: 'spent' });
  });
});

describe('chatNote', () => {
  it('leads with the state that needs attention, then the wins', () => {
    expect(chatNote({ ...CHAT, state: 'waiting', kept: 2, prs: 1 })).toBe(
      'Needs you · 2 kept · 1 PR',
    );
    expect(chatNote({ ...CHAT, tickets: 2 })).toBe('2 tickets');
  });

  it('falls back to the project for a finished chat with nothing to count', () => {
    expect(chatNote(CHAT)).toBe('app');
    expect(chatNote({ ...CHAT, project: null })).toBe('Done');
  });
});

describe('chatExpression', () => {
  it('matches the blob mood to the chat state', () => {
    expect(chatExpression('waiting')).toBe('unsure');
    expect(chatExpression('failed')).toBe('sad');
    expect(chatExpression('finished')).toBe('happy');
  });
});
