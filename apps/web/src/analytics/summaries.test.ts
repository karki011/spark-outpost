import { describe, expect, it } from 'vitest';
import type { AnalyticsHarness, HealthScore, OverviewDay } from '@spark-outpost/contracts';
import { categoryName, depthName, duration, signedScore, shortDate } from './analytics-model.ts';
import { disagreementSummary, flowSummary } from './harness-summaries.ts';
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

const tally = (turns: number, meanScore: number | null) => ({
  turns,
  meanScore,
  good: turns,
  bad: 0,
  mixed: 0,
  unclear: 0,
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

  it('summarises the routing flow and the rule-vs-Jev comparison', () => {
    const harness = {
      turns: 5,
      flow: [
        {
          category: 'bug_fix',
          depth: 'execute',
          crew: 'Builder',
          model: 'Sonnet 5',
          provider: 'claude',
          outcome: 'good',
          turns: 3,
        },
        {
          category: 'question',
          depth: 'direct',
          crew: 'Solo',
          model: 'Haiku 4.5',
          provider: 'claude',
          outcome: 'bad',
          turns: 2,
        },
      ],
      agreement: [
        { key: 'same', ...tally(3, 0.5) },
        { key: 'differs', ...tally(2, -0.25) },
        { key: 'no_jev', ...tally(0, null) },
      ],
      disagreements: [],
    } as unknown as AnalyticsHarness;
    expect(flowSummary(harness)).toBe(
      '5 turns. Most were bug fix requests (3), most ran at execute depth (3) with a crew of Builder (3), and Sonnet 5 did the most work (3). 60% ended with a good outcome.',
    );
    expect(disagreementSummary(harness)).toMatch(/^They disagreed on 2 turns \(mean -0\.25\)/);
  });

  it('formats labels', () => {
    expect([
      shortDate('2026-03-01'),
      signedScore(0.456),
      signedScore(-0.1),
      signedScore(null),
    ]).toEqual(['Mar 1', '+0.46', '-0.10', '—']);
    expect([categoryName('bug_fix'), categoryName('mystery'), depthName('plan_execute')]).toEqual([
      'Bug fix',
      'Uncategorised',
      'Plan → execute',
    ]);
    expect([duration(null), duration(42_000), duration(125_000)]).toEqual(['—', '42s', '2m 5s']);
  });
});
