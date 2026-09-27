import { describe, expect, it } from 'vitest';
import { fact } from './fact-fixture.ts';
import {
  agreement,
  confidencePoints,
  crewShape,
  disagreements,
  flowPaths,
  leanRows,
  loopSummary,
  waitSummary,
  winner,
} from './harness.ts';
import { rollups } from './rollups.ts';
import { checkRollup, outcomeTally, quantile } from './tally.ts';

const modelPick = { field: 'model', rule: 'Haiku 4.5', jev: 'Sonnet 5' };

describe('crew shape and flow', () => {
  it('names the crew in role order', () => {
    expect(crewShape([], 0)).toBe('Solo');
    expect(crewShape(['critic', 'builder', 'architect'], 2)).toBe(
      'Architect + Builder ×2 + Critic',
    );
    expect(crewShape(['scout', 'builder'], 1)).toBe('Scout + Builder');
  });

  it('merges identical paths and marks turns without an outcome as pending', () => {
    const paths = flowPaths([fact(), fact(), fact({ verdict: null, score: null })]);
    expect(paths.map((path) => [path.outcome, path.turns])).toEqual([
      ['good', 2],
      ['pending', 1],
    ]);
  });
});

describe('Jev against the rules', () => {
  it('plots only answered turns with an outcome', () => {
    const points = confidencePoints([
      fact({ jevConfidence: 0.91234, gateDecision: 'act', actAt: 0.9 }),
      fact({ jevConfidence: 0.7, verdict: null }),
      fact(),
    ]);
    expect(points).toEqual([
      { confidence: 0.912, score: 1, verdict: 'good', decision: 'act', actAt: 0.9 },
    ]);
  });

  it('calls a winner only with three turns a side and a clear gap', () => {
    const tally = (scores: number[]) =>
      outcomeTally(scores.map((score) => fact({ score, verdict: score > 0 ? 'good' : 'bad' })));
    expect(winner(tally([1, 1, 1]), tally([-1, -1, -1]))).toBe('jev');
    expect(winner(tally([-1, -1, -1]), tally([1, 1, 1]))).toBe('rules');
    expect(winner(tally([0.5, 0.5, 0.5]), tally([0.4, 0.4, 0.4]))).toBe('tie');
    expect(winner(tally([1, 1]), tally([-1, -1, -1]))).toBe('not_enough');
  });

  it('groups disagreements by field and pick and tracks which pick ran', () => {
    const answered = { jevAnswered: true, differences: [modelPick] };
    const rows = disagreements([
      fact({ ...answered, wouldApply: 'jev', score: 0.9 }),
      fact({ ...answered, wouldApply: 'rules', score: -0.5, verdict: 'bad' }),
      fact({ ...answered, wouldApply: 'ask' }),
      fact({ jevAnswered: false, differences: [modelPick] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      field: 'model',
      rulePick: 'Haiku 4.5',
      jevPick: 'Sonnet 5',
      turns: 3,
      asked: 1,
      winner: 'not_enough',
    });
    expect(rows[0]!.jevRan).toMatchObject({ turns: 1, good: 1, meanScore: 0.9 });
  });

  it('splits agreement into same, differs and no Jev', () => {
    const rows = agreement([
      fact({ jevAnswered: true }),
      fact({ jevAnswered: true, differences: [modelPick] }),
      fact(),
    ]);
    expect(rows.map((row) => [row.key, row.turns])).toEqual([
      ['same', 1],
      ['differs', 1],
      ['no_jev', 1],
    ]);
  });
});

describe('quality slices', () => {
  it('compares build styles on building turns only', () => {
    const rows = leanRows([
      fact({ buildStyle: 'lean', reviews: [{ verdict: 'looks_good', findings: 1, net: -12 }] }),
      fact({ buildStyle: 'lean', reportedUsd: 0.3, kept: false }),
      fact({ roles: [], buildStyle: 'lean' }),
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        style: 'lean',
        turns: 2,
        kept: 1,
        netLines: -12,
        meanCostUsd: 0.2,
      }),
    ]);
  });

  it('rolls check rounds per Builder and counts fix loops', () => {
    expect(checkRollup([])).toBeNull();
    expect(checkRollup([{ key: 'Bolt:', round: 1, status: 'skipped' }])).toBeNull();
    expect(
      checkRollup([
        { key: 'Bolt:', round: 1, status: 'failed' },
        { key: 'Rivet:', round: 1, status: 'passed' },
        { key: 'Bolt:', round: 2, status: 'passed' },
      ]),
    ).toEqual({ firstPassed: false, finalPassed: true, fixLoop: true, rounds: 3 });
    const loops = loopSummary([
      fact({ retries: 2 }),
      fact({ checks: [{ key: 'Bolt:', round: 2, status: 'passed' }] }),
      fact({ roles: [] }),
    ]);
    expect(loops).toEqual({ turns: 2, withRetries: 2, retries: 2, fixLoops: 1 });
  });

  it('summarises approval waits per kind', () => {
    const summary = waitSummary([
      { kind: 'execute', waitMs: 10_000 },
      { kind: 'execute', waitMs: 30_000 },
      { kind: 'plan', waitMs: 90_000 },
    ]);
    expect(summary).toEqual({
      count: 3,
      medianMs: 30_000,
      byKind: [
        { kind: 'execute', count: 2, medianMs: 20_000, p90Ms: 28_000 },
        { kind: 'plan', count: 1, medianMs: 90_000, p90Ms: 90_000 },
      ],
    });
    expect(quantile([], 0.5)).toBeNull();
  });

  it('rolls up by day in date order and by other keys by cost', () => {
    const facts = [
      fact({ day: '2026-09-21', reportedUsd: 0.5 }),
      fact({ day: '2026-09-20', project: 'docs', jevUsd: 0.01, retries: 1 }),
    ];
    expect(rollups(facts, 'day').map((row) => row.key)).toEqual(['2026-09-20', '2026-09-21']);
    const byProject = rollups(facts, 'project');
    expect(byProject.map((row) => [row.key, row.costUsd, row.retries])).toEqual([
      ['spark-outpost', 0.5, 0],
      ['docs', 0.11, 1],
    ]);
    expect(byProject[1]!.estimatedUsd).toBe(0.01);
  });
});
