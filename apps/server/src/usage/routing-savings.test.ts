import { describe, expect, it } from 'vitest';
import { routingSavings, tallySavings, topModelCard, type RoutedRun } from './routing-savings.ts';

const tokens = (input: number, output: number, cachedRead: number | null = null) => ({
  input,
  output,
  cachedRead,
  cachedWrite: null,
});

const routed = (provider: string, model: string | null, input: number, output: number) =>
  ({ provider, model, modelLabel: null, tokens: tokens(input, output) }) satisfies RoutedRun;

const NONE = new Map();

describe('topModelCard', () => {
  it('uses the highest non-frontier model the provider offers', () => {
    const offered = new Map([
      [
        'claude',
        [
          { id: 'haiku', label: 'Haiku 4.5' },
          { id: 'sonnet', label: 'Sonnet 5' },
          { id: 'claude-fable-5-1', label: 'Fable 5.1' },
        ],
      ],
    ]);
    expect(topModelCard('claude', offered)?.id).toBe('claude-sonnet-5');
  });

  it('falls back to the cheapest top-tier card when nothing is offered', () => {
    expect(topModelCard('claude', NONE)?.id).toBe('claude-opus-5-5');
    expect(topModelCard('codex', NONE)?.id).toBe('gpt-5.6-sol');
    expect(topModelCard('fake', NONE)).toBeNull();
  });
});

describe('tallySavings', () => {
  it('prices the same tokens at the routed and the top model', () => {
    const tally = tallySavings(
      [
        routed('claude', 'claude-sonnet-5', 1_000_000, 100_000),
        routed('claude', 'haiku', 2_000_000, 0),
      ],
      NONE,
    );
    expect(tally.runs).toBe(2);
    expect(tally.grossUsd).toBeCloseTo(3 + 6);
  });

  it('counts a run on the top model as no saving and a frontier run as a loss', () => {
    const tally = tallySavings(
      [routed('claude', 'opus', 1_000_000, 0), routed('claude', 'claude-fable-5-1', 1_000_000, 0)],
      NONE,
    );
    expect(tally).toEqual({ runs: 2, grossUsd: -6 });
  });

  it('skips runs it cannot price', () => {
    const tally = tallySavings(
      [
        routed('claude', null, 1_000_000, 0),
        routed('claude', 'mystery-model', 1_000_000, 0),
        routed('fake', 'fake-model', 1_000_000, 0),
      ],
      NONE,
    );
    expect(tally).toEqual({ runs: 0, grossUsd: 0 });
  });

  it('charges cached input at the cached rate for both models', () => {
    const run = {
      ...routed('claude', 'sonnet', 1_000_000, 0),
      tokens: tokens(1_000_000, 0, 500_000),
    };
    const tally = tallySavings([run], NONE);
    expect(tally.grossUsd).toBeCloseTo(0.5 * 4 + 0.5 * 0.2 - (0.5 * 2 + 0.5 * 0.2), 5);
  });
});

describe('routingSavings', () => {
  it('reports nothing without routed runs and subtracts what Jev cost', () => {
    expect(routingSavings({ runs: 0, grossUsd: 0 }, 0.2)).toBeNull();
    expect(routingSavings({ runs: 3, grossUsd: 1.25 }, 0.05)).toEqual({
      runs: 3,
      grossUsd: 1.25,
      jevCostUsd: 0.05,
      netUsd: 1.2,
    });
  });
});
