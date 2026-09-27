import { describe, expect, it } from 'vitest';
import { formatWait, healthGrade, healthScore, type HealthInputs } from './health.ts';

const base: HealthInputs = {
  verdicts: { good: 16, bad: 2, mixed: 2, unclear: 3 },
  settled: 23,
  troubled: 3,
  checks: { turns: 10, firstPassed: 8, finalPassed: 10, fixLoops: 2, rounds: 12 },
  loops: { turns: 12, withRetries: 3, retries: 2, fixLoops: 2 },
  waits: 6,
  medianWaitMs: 45_000,
};

describe('health score', () => {
  it('weights each component and explains it', () => {
    const health = healthScore(base);
    expect(health.components.map((part) => [part.id, part.score])).toEqual([
      ['outcomes', 85],
      ['checks', 80],
      ['corrections', 87],
      ['loops', 75],
      ['waits', 97],
    ]);
    expect(health.score).toBe(Math.round((85 * 40 + 80 * 20 + 87 * 20 + 75 * 10 + 97 * 10) / 100));
    expect(health.grade).toBe('healthy');
    expect(health.components[4]!.detail).toBe('The median wait for your approval was 45s.');
  });

  it('leaves out components with too little data and reweights the rest', () => {
    const health = healthScore({
      ...base,
      checks: { turns: 2, firstPassed: 0, finalPassed: 2, fixLoops: 2, rounds: 4 },
      waits: 0,
      medianWaitMs: null,
    });
    const checks = health.components.find((part) => part.id === 'checks')!;
    expect(checks).toMatchObject({ score: null, detail: 'Not enough data yet (n=2).' });
    expect(health.score).toBe(Math.round((85 * 40 + 87 * 20 + 75 * 10) / 70));
  });

  it('has no score until outcomes are measurable', () => {
    const health = healthScore({ ...base, verdicts: { good: 2, bad: 1, mixed: 0, unclear: 9 } });
    expect(health).toMatchObject({ score: null, grade: 'not_enough_data' });
  });

  it('clamps slow and fast approval waits', () => {
    const slow = healthScore({ ...base, medianWaitMs: 3_600_000 });
    const fast = healthScore({ ...base, medianWaitMs: 1_000 });
    expect(slow.components.find((part) => part.id === 'waits')!.score).toBe(0);
    expect(fast.components.find((part) => part.id === 'waits')!.score).toBe(100);
  });

  it('grades and formats', () => {
    expect([healthGrade(80), healthGrade(79), healthGrade(59), healthGrade(null)]).toEqual([
      'healthy',
      'fair',
      'needs_attention',
      'not_enough_data',
    ]);
    expect([formatWait(12_400), formatWait(120_000), formatWait(95_000)]).toEqual([
      '12s',
      '2m',
      '1m 35s',
    ]);
  });
});
