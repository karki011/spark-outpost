import { describe, expect, it } from 'vitest';
import type { ModelStat } from '@spark-outpost/contracts';
import { formatPrice, formatTokenCount, statLines } from './model-card-stats.ts';

const stat = (overrides: Partial<ModelStat>): ModelStat => ({
  source: 'benchmark',
  round: 'baseline',
  measuredOn: '2026-09-26',
  file: 'f.json',
  provider: 'claude',
  model: 'claude-sonnet-5',
  agentModel: 'sonnet',
  effort: 'medium',
  role: 'builder',
  category: 'fix',
  n: 2,
  passed: 2,
  meanCostUsd: 0.1,
  costSource: 'reported',
  meanWallMs: 20_000,
  sharedCredit: 0,
  ...overrides,
});

describe('model card stats', () => {
  it('adds rounds together per category, role and effort, weighting means by runs', () => {
    const lines = statLines([
      stat({}),
      stat({ round: 'tuned', n: 2, passed: 1, meanCostUsd: 0.2, meanWallMs: 40_000 }),
      stat({ role: 'architect', category: 'plan', effort: 'high', n: 1, passed: 1 }),
    ]);
    expect(lines[0]).toMatchObject({
      label: 'fix as Builder · medium',
      n: 4,
      passed: 3,
      rounds: ['baseline', 'tuned'],
      anecdotal: false,
    });
    expect(lines[0]!.meanCostUsd).toBeCloseTo(0.15);
    expect(lines[0]!.meanWallMs).toBe(30_000);
    expect(lines[1]).toMatchObject({ label: 'plan as Architect · high', anecdotal: true });
  });

  it('formats context sizes and prices', () => {
    expect(formatTokenCount(1_050_000)).toBe('1.05M');
    expect(formatTokenCount(200_000)).toBe('200K');
    expect(formatPrice(0.1)).toBe('$0.1');
    expect(formatPrice(12.5)).toBe('$12.5');
  });
});
