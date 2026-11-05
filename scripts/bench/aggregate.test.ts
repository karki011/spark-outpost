import { describe, expect, it } from 'vitest';
import { aggregate, projectedCostUsd, stat } from './aggregate.ts';
import { renderHtml } from './render-html.ts';
import { preservedAnalysis, renderMarkdown } from './render-md.ts';
import type { AgentUsage, BenchRun, CellResult } from './results.ts';
import { niceMax } from './svg-chart.ts';

function agent(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return {
    role: 'builder',
    name: 'Bolt',
    provider: 'claude',
    model: 'sonnet',
    effort: 'medium',
    status: 'succeeded',
    inputTokens: 1000,
    outputTokens: 200,
    cachedReadTokens: 800,
    cachedWriteTokens: 0,
    costUsd: 0.02,
    costSource: 'reported',
    durationMs: 5000,
    toolCalls: 2,
    parallelGroup: null,
    ...overrides,
  };
}

function result(overrides: Partial<CellResult> = {}): CellResult {
  return {
    task: 'T1',
    mode: 'direct',
    repeat: 1,
    runId: 'run',
    status: 'succeeded',
    error: null,
    startedAt: '2026-09-26T00:00:00.000Z',
    wallMs: 10_000,
    activeMs: 10_000,
    agents: [agent()],
    toolCalls: 2,
    retries: 0,
    agentCostUsd: 0.02,
    jevCostUsd: 0,
    jevCalls: 0,
    costUsd: 0.02,
    asked: [],
    verification: {
      passed: true,
      reasons: [],
      suite: { tests: 7, pass: 7, fail: 0 },
      hidden: { tests: 2, pass: 2, fail: 0 },
      outOfScope: [],
      diff: { files: ['src/greet.ts'], added: 1, removed: 1 },
    },
    routing: null,
    ...overrides,
  };
}

const failed = (base: CellResult): CellResult => ({
  ...base,
  verification: { ...base.verification, passed: false, reasons: ['Hidden checks: 1 of 2 failed.'] },
});

const results: CellResult[] = [
  result(),
  result({ repeat: 2, wallMs: 20_000, activeMs: 18_000, costUsd: 0.04 }),
  result({
    mode: 'harness',
    wallMs: 30_000,
    activeMs: 30_000,
    agents: [agent({ role: 'architect', model: 'opus[1m]' }), agent({ model: 'haiku' })],
    costUsd: 0.09,
    jevCostUsd: 0.001,
    routing: { depth: 'plan_execute', depthSource: 'jev', risk: 'edits', decisions: [] },
  }),
  failed(result({ task: 'T2', mode: 'harness', costUsd: 0.05 })),
];

describe('stat', () => {
  it('reports mean, min and max, and zeros for no values', () => {
    expect(stat([1, 2, 6])).toEqual({ mean: 3, min: 1, max: 6 });
    expect(stat([])).toEqual({ mean: 0, min: 0, max: 0 });
  });
});

describe('aggregate', () => {
  const summary = aggregate(results);

  it('summarises each task and mode cell', () => {
    const direct = summary.cells.find((cell) => cell.task === 'T1' && cell.mode === 'direct');
    expect(direct).toMatchObject({
      runs: 2,
      passed: 2,
      wallMs: { mean: 15_000, min: 10_000, max: 20_000 },
      costUsd: { mean: 0.03 },
      tokens: { mean: 2000 },
      models: ['builder:sonnet'],
    });
    const harness = summary.cells.find((cell) => cell.task === 'T1' && cell.mode === 'harness');
    expect(harness?.agents.mean).toBe(2);
    expect(harness?.models).toEqual(['architect:opus[1m]', 'builder:haiku']);
  });

  it('compares harness against direct per task', () => {
    const t1 = summary.comparisons.find((comparison) => comparison.task === 'T1');
    expect(t1?.costRatio).toBeCloseTo(3);
    expect(t1?.wallRatio).toBeCloseTo(2);
    const t2 = summary.comparisons.find((comparison) => comparison.task === 'T2');
    expect(t2).toEqual({
      task: 'T2',
      costRatio: null,
      wallRatio: null,
      directPassRate: null,
      harnessPassRate: 0,
    });
  });

  it('totals each mode and the overall spend', () => {
    expect(summary.totals).toEqual([
      expect.objectContaining({ mode: 'direct', runs: 2, passed: 2, wallMs: 30_000 }),
      expect.objectContaining({ mode: 'harness', runs: 2, passed: 1, jevCostUsd: 0.001 }),
    ]);
    expect(summary.spentUsd).toBeCloseTo(0.2);
  });
});

describe('projectedCostUsd', () => {
  it('uses the most expensive observed run with headroom, or the fallback', () => {
    expect(projectedCostUsd(results, 'T1', 'direct', 1)).toBeCloseTo(0.05);
    expect(projectedCostUsd(results, 'T3', 'direct', 1)).toBe(1);
  });
});

describe('reports', () => {
  const run: BenchRun = {
    version: 1,
    date: '2026-09-26',
    budgetUsd: 6,
    spentUsd: 0.2,
    stoppedForBudget: false,
    settings: { direct: 'd', harness: 'h', level: 'full-auto', fixture: 'f' },
    results,
  };

  it('keeps a hand-written Markdown analysis across regenerations', () => {
    const first = renderMarkdown(run, null);
    expect(first).toContain('| T1 | 2/2 | 1/1 | $0.030 | $0.090 | 3.00× |');
    const edited = first.replace('To be written after the runs.', 'Harness lost on T1.');
    expect(renderMarkdown(run, preservedAnalysis(edited))).toContain('Harness lost on T1.');
  });

  it('keeps the HTML analysis section and draws one bar per task and mode', () => {
    const edited = renderHtml(run, null).replace(
      '<p>To be written after the runs.</p>',
      '<p>Kept</p>',
    );
    const again = renderHtml(run, edited);
    expect(again).toContain('<p>Kept</p>');
    expect(again.match(/<path class="s[12]"/g)).toHaveLength(6);
  });

  it('compares the tuned harness with the baseline and reports the hard set', () => {
    const tuned: BenchRun = {
      ...run,
      date: '2026-09-26-tuned',
      results: [
        result(),
        result({ mode: 'harness', costUsd: 0.01, wallMs: 5_000 }),
        result({ task: 'H1', costUsd: 0.1 }),
        failed(result({ task: 'H1', repeat: 2, costUsd: 0.1 })),
        result({
          task: 'H1',
          mode: 'harness',
          costUsd: 0.3,
          agents: [agent({ role: 'critic', provider: 'codex' })],
        }),
      ],
    };
    const markdown = renderMarkdown(tuned, null, run);
    expect(markdown).toContain('## Against the baseline run');
    expect(markdown).toContain(
      '| T1 | 2/2 / 1/1 | 1/1 / 1/1 | $0.020 | $0.090 | $0.010 | 3.00× | 0.50× |',
    );
    expect(markdown).toContain('Pass rate over the hard tasks: direct 1/2, harness 1/1.');
    expect(markdown).toContain('| H1 · Half-cent rounding | 1/2 | 1/1 | $0.100 | $0.300 | 3.00× |');
    const html = renderHtml(tuned, null, run);
    expect(html).toContain('<h2>Hard set</h2>');
    expect(html.match(/<path class="s3"/g)?.length).toBeGreaterThan(0);
  });

  it('rounds chart axes up to a readable maximum', () => {
    expect(niceMax(0.37)).toBe(0.4);
    expect(niceMax(73)).toBe(80);
    expect(niceMax(0)).toBe(1);
  });
});
