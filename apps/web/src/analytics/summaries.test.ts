import { describe, expect, it } from 'vitest';
import type { AnalyticsSpend, HealthScore, OverviewDay } from '@spark-outpost/contracts';
import { signedScore, shortDate } from './analytics-model.ts';
import { taskCostSummary } from './spend-summaries.ts';
import { activitySummary, healthSummary, spendSummary } from './summaries.ts';

const day = (date: string, turns: number, costUsd: number): OverviewDay => ({
  date,
  turns,
  runs: turns,
  costUsd,
  good: turns,
  bad: 0,
  mixed: 0,
  unclear: 0,
  kept: 0,
  reverted: 0,
});

describe('analytics text alternatives', () => {
  it('describes activity and spend, including empty ranges', () => {
    const days = [day('2026-09-20', 0, 0), day('2026-09-21', 4, 1), day('2026-09-22', 2, 3)];
    expect(activitySummary(days)).toBe(
      '6 turns on 2 of 3 days. The busiest day was Sep 21 with 4 turns.',
    );
    expect(activitySummary([day('2026-09-20', 0, 0)])).toBe('No turns in the last 1 day.');
    expect(spendSummary(days, 4)).toBe(
      '$4.00 in total, $1.33 a day on average. The highest day was Sep 22 at $3.00.',
    );
    expect(spendSummary(days, 0)).toBe('Nothing was spent in this range.');
  });

  it('names the weakest health component, or says why there is no score', () => {
    const health: HealthScore = {
      score: 72,
      grade: 'fair',
      components: [
        { id: 'outcomes', label: 'Good outcomes', score: 80, weight: 40, n: 30, detail: '' },
        { id: 'checks', label: 'Checks pass first time', score: 55, weight: 20, n: 9, detail: '' },
        { id: 'waits', label: 'Quick approvals', score: null, weight: 10, n: 1, detail: '' },
      ],
    };
    expect(healthSummary(health)).toBe(
      'Health is 72 of 100 (fair). The weakest part is checks pass first time at 55.',
    );
    expect(healthSummary({ ...health, score: null, grade: 'not_enough_data' })).toMatch(
      /not enough/,
    );
  });

  it('formats labels', () => {
    expect([
      shortDate('2026-03-01'),
      signedScore(0.456),
      signedScore(-0.1),
      signedScore(null),
    ]).toEqual(['Mar 1', '+0.46', '-0.10', '—']);
  });

  it('describes cost per finished turn even when no turn has a mean cost', () => {
    const spend: AnalyticsSpend = {
      window: { range: '30d', from: '2026-08-30', to: '2026-09-28', days: 30, timeZone: 'UTC' },
      totalUsd: 0,
      reportedUsd: 0,
      estimatedUsd: 0,
      unpricedRuns: 2,
      jev: { calls: 0, costUsd: 0 },
      leaves: [],
      days: [],
      perTask: [{ verdict: 'good', tasks: 2, costUsd: 0, meanUsd: null, medianUsd: null }],
      finishedTasks: 2,
      costPerGoodUsd: null,
      resume: { resumedRuns: 0, sessionRuns: 0, cachedTokens: 0, savedUsd: 0 },
    };
    expect(taskCostSummary(spend)).toBe(
      '2 finished turns, none with a known cost yet. No turn had a good outcome yet.',
    );
  });
});
