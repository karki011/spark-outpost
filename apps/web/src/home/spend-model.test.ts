import { describe, expect, it } from 'vitest';
import type { ProviderTotals } from '@spark-outpost/contracts';
import { activityLine, costSlices, savingsLine, savingsTip } from './spend-model.ts';

const savings = (netUsd: number) => ({
  runs: 2,
  grossUsd: netUsd + 0.01,
  jevCostUsd: 0.01,
  netUsd,
});

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

describe('savingsLine', () => {
  it('hides the line when Jev routed nothing', () => {
    expect(savingsLine(null)).toBeNull();
  });

  it('reports a saving, a loss, or a wash honestly', () => {
    expect(savingsLine(savings(1.234))).toBe(
      'Jev routing saved ≈$1.23 vs always using the top model',
    );
    expect(savingsLine(savings(-0.5))).toBe(
      'Jev routing cost ≈$0.50 more than always using the top model',
    );
    expect(savingsLine(savings(0.001))).toBe(
      'Jev routing cost about the same as always using the top model',
    );
  });

  it('explains the estimate and what Jev cost', () => {
    expect(savingsTip(savings(1))).toBe(
      'Estimated from list prices for the same tokens over 2 turns Jev routed, after $0.01 for Jev itself.',
    );
  });
});

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
