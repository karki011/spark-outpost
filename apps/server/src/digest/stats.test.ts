import { describe, expect, it } from 'vitest';
import type { ActivityChat } from './input.ts';
import { computeDigestStats, fallbackHeadline } from './stats.ts';

function chat(overrides: Partial<ActivityChat> = {}): ActivityChat {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'A chat',
    project: null,
    category: null,
    updatedAt: '2026-09-26T14:00:00.000Z',
    state: 'idle',
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

describe('computeDigestStats', () => {
  it('counts finished, waiting and failed-or-stalled chats and sums cost', () => {
    const chats = [
      chat({ state: 'finished', costUsd: 0.5 }),
      chat({ state: 'finished', costUsd: 0.34 }),
      chat({ state: 'waiting' }),
      chat({ state: 'failed', costUsd: 0.01 }),
      chat({ state: 'stalled' }),
      chat({ state: 'running' }),
    ];
    const stats = computeDigestStats(chats);
    expect(stats).toMatchObject({ finished: 2, waiting: 1, failedOrStalled: 2 });
    expect(stats.costUsd).toBeCloseTo(0.85);
  });

  it('reports no cost when nothing reported one', () => {
    expect(computeDigestStats([chat({ state: 'finished' })]).costUsd).toBeNull();
  });

  it('handles an empty snapshot', () => {
    expect(computeDigestStats([])).toEqual({
      finished: 0,
      waiting: 0,
      failedOrStalled: 0,
      costUsd: null,
    });
  });
});

describe('fallbackHeadline', () => {
  it('names the counts and total spend', () => {
    expect(fallbackHeadline({ finished: 2, waiting: 1, failedOrStalled: 1, costUsd: 0.84 })).toBe(
      '2 chats finished, 1 chat needs you, 1 chat failed or stalled, $0.84 spent.',
    );
  });

  it('uses singular wording for one item', () => {
    expect(fallbackHeadline({ finished: 1, waiting: 0, failedOrStalled: 0, costUsd: null })).toBe(
      '1 chat finished.',
    );
  });

  it('falls back to a quiet line when nothing happened', () => {
    expect(fallbackHeadline({ finished: 0, waiting: 0, failedOrStalled: 0, costUsd: null })).toBe(
      'Nothing new.',
    );
  });

  it('omits zero spend and stays within the length limit', () => {
    const headline = fallbackHeadline({
      finished: 0,
      waiting: 0,
      failedOrStalled: 0,
      costUsd: 0,
    });
    expect(headline).toBe('Nothing new.');
    expect(headline.length).toBeLessThanOrEqual(140);
  });
});
