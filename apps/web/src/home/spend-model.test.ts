import { describe, expect, it } from 'vitest';
import type { ProviderTotals } from '@spark-outpost/contracts';
import { activityLine, costSlices } from './spend-model.ts';

function totals(provider: string, costUsd: number | null): ProviderTotals {
  return {
    provider,
    runs: 1,
    costUsd,
    costSource: 'reported',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

describe('spend lines', () => {
  it('counts runs and tokens', () => {
    expect(activityLine({ runs: 1, totalTokens: 950 })).toBe('1 run · 950 tokens');
    expect(activityLine({ runs: 12, totalTokens: 340_000 })).toBe('12 runs · 340K tokens');
  });

  it('keeps priced providers, most expensive first', () => {
    const slices = costSlices({
      byProvider: [
        totals('codex', 0.1),
        totals('claude', 0.9),
        totals('zai', null),
        totals('jev', 0),
      ],
    });
    expect(slices.map((row) => row.provider)).toEqual(['claude', 'codex']);
  });
});
