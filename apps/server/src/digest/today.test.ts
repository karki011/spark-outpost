import { describe, expect, it } from 'vitest';
import { todaySummarySchema } from '@spark-outpost/contracts';
import type { ActivityChat } from './input.ts';
import { buildToday } from './today.ts';

function chat(index: number, overrides: Partial<ActivityChat> = {}): ActivityChat {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    title: `Chat ${index}`,
    project: null,
    category: null,
    updatedAt: `2026-09-30T0${index}:00:00.000Z`,
    state: 'finished',
    waitingOn: null,
    error: null,
    plan: null,
    filesChanged: 0,
    reverted: false,
    checks: null,
    lastReply: null,
    costUsd: null,
    ...overrides,
  };
}

const SPEND = { since: '2026-09-30T00:00:00.000Z', costUsd: 1.25, costSource: 'reported' as const };

describe('buildToday', () => {
  it('totals wins across chats and lists the most recent chats first', () => {
    const activity = [1, 2, 3, 4, 5].map((index) =>
      chat(index, index === 2 ? { state: 'waiting' } : {}),
    );
    const today = buildToday(SPEND, activity, [
      { id: activity[0]!.id, kept: 2, prs: 1, tickets: 0 },
      { id: activity[4]!.id, kept: 1, prs: 0, tickets: 2 },
    ]);

    expect(todaySummarySchema.parse(today)).toEqual(today);
    expect(today).toMatchObject({
      chats: 5,
      waiting: 1,
      kept: 3,
      prs: 1,
      tickets: 2,
      costUsd: 1.25,
      costSource: 'reported',
    });
    expect(today.recent.map((entry) => entry.title)).toEqual([
      'Chat 5',
      'Chat 4',
      'Chat 3',
      'Chat 2',
    ]);
    expect(today.recent[0]).toMatchObject({ kept: 1, tickets: 2, prs: 0 });
  });

  it('reports a quiet day as zeros with no chats', () => {
    const today = buildToday({ ...SPEND, costUsd: null, costSource: null }, [], []);
    expect(today).toMatchObject({ chats: 0, kept: 0, prs: 0, tickets: 0, costUsd: null });
    expect(today.recent).toEqual([]);
  });
});
