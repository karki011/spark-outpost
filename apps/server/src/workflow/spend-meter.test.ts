import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../providers/provider.ts';
import { createLiveCost } from '../usage/live-cost.ts';
import { createSpendMeter } from './spend-meter.ts';

const usage = (costUsd: number): ProviderOutput => ({
  kind: 'usage',
  contextUsed: 1_000,
  contextSize: 200_000,
  costUsd,
});

function meter() {
  const told: number[] = [];
  const spend = createSpendMeter(createLiveCost('claude', 'sonnet'), (usd) => told.push(usd));
  return { spend, told };
}

describe('createSpendMeter', () => {
  it('counts a reported cost the moment the agent reports it, before the reader records it', () => {
    const { spend, told } = meter();
    spend.produced(usage(0.03));
    spend.produced(usage(0.06));
    spend.produced(usage(0.09));
    expect(told).toEqual([0.03, 0.06, 0.09]);
  });

  it('stops counting the part the reader has recorded, so nothing is counted twice', () => {
    const { spend, told } = meter();
    spend.produced(usage(0.06));
    spend.recording(usage(0.03));
    spend.read(usage(0.03));
    spend.recording(usage(0.06));
    spend.read(usage(0.06));
    expect(told).toEqual([0.06, 0.03, 0]);
  });

  it('ignores a repeated or lower cost at production', () => {
    const { spend, told } = meter();
    spend.produced(usage(0.05));
    spend.produced(usage(0.05));
    spend.produced(usage(0.04));
    expect(told).toEqual([0.05]);
  });
});
