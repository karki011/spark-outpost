import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../providers/provider.ts';
import { createLiveCost } from './live-cost.ts';
import type { ModelPrice } from './prices.ts';

const PRICE: ModelPrice = {
  provider: 'claude',
  model: 'claude-test',
  inputPerMillion: 2,
  cachedInputPerMillion: 0.2,
  cacheWritePerMillion: 2.5,
  outputPerMillion: 10,
  cacheOutsideInput: true,
};

const known = (_provider: string, model: string | null) => (model === 'test' ? PRICE : null);

const context = (used: number, readings?: 'start_and_end'): ProviderOutput => ({
  kind: 'usage',
  contextUsed: used,
  contextSize: 200_000,
  costUsd: null,
  ...(readings ? { readings } : {}),
});
const edge = (used: number) => context(used, 'start_and_end');

function meter(outputs: readonly ProviderOutput[], model = 'test') {
  const live = createLiveCost('claude', model, known);
  for (const output of outputs) live.observe(output);
  return live.unreported();
}

describe('live cost', () => {
  it('prices calls read at their start and end: context in, then output', () => {
    const cost = meter([edge(20_000), edge(20_500), edge(22_000), edge(22_300)]);
    expect(cost).toBeCloseTo(0.05 + 0.005 + 0.0041 + 0.00375 + 0.003, 6);
  });

  it('prices calls read once after they finish as context in', () => {
    const cost = meter([context(20_000), context(22_000)]);
    expect(cost).toBeCloseTo(0.05 + 0.004 + 0.005, 6);
  });

  it('ignores a repeated reading and treats a shrunk context as a new call', () => {
    const cost = meter([edge(10_000), edge(10_000), edge(10_400), edge(4_000)]);
    expect(cost).toBeCloseTo(0.025 + 0.004 + 0.0008, 6);
  });

  it('prices a resumed session as cached from its first call', () => {
    const resumed: ProviderOutput = {
      kind: 'session',
      sessionId: 's',
      cwd: '/tmp',
      additionalDirectories: [],
      continued: true,
      freshReason: null,
    };
    expect(meter([resumed, context(50_000)])).toBeCloseTo(0.01, 6);
  });

  it('starts over when the provider reports its own cost', () => {
    const cost = meter([
      context(20_000),
      { kind: 'usage', contextUsed: 20_000, contextSize: 200_000, costUsd: 0.3 },
      {
        kind: 'tokens',
        tokens: { input: 5, output: 5, total: 10, cachedRead: 0, cachedWrite: 0, thought: null },
      },
    ]);
    expect(cost).toBe(0);
  });

  it('switches to the final token counts when no cost is reported', () => {
    const cost = meter([
      context(90_000),
      {
        kind: 'tokens',
        tokens: {
          input: 1_000,
          output: 1_000,
          total: 12_000,
          cachedRead: 10_000,
          cachedWrite: null,
          thought: null,
        },
      },
    ]);
    expect(cost).toBeCloseTo(0.002 + 0.002 + 0.01, 6);
  });

  it('follows the model the agent reports using', () => {
    const cost = meter(
      [{ kind: 'session_settings', model: 'test', effort: null, mode: null }, context(10_000)],
      'unknown',
    );
    expect(cost).toBeCloseTo(0.025, 6);
  });

  it('estimates nothing for a model without a price', () => {
    expect(meter([context(10_000)], 'unknown')).toBe(0);
  });
});
