import { describe, expect, it } from 'vitest';
import {
  recordedTotals,
  renderContextReport,
  summarise,
  type ContextRow,
} from './context-report.ts';
import type { BenchRun, CellResult } from './results.ts';

function row(overrides: Partial<ContextRow>): ContextRow {
  return {
    task: 'T2',
    variant: 'block',
    hintTokens: 200,
    files: 4,
    leadFiles: 3,
    excerpts: 1,
    filesAtK: { hits: 1, precision: 0.25, recall: 1 },
    ...overrides,
  };
}

function cell(overrides: Partial<CellResult>): CellResult {
  return {
    task: 'T2',
    mode: 'harness',
    repeat: 1,
    runId: 'run',
    status: 'succeeded',
    error: null,
    startedAt: '2026-10-03T00:00:00.000Z',
    wallMs: 1,
    activeMs: 1,
    agents: [],
    toolCalls: 0,
    retries: 0,
    agentCostUsd: 0,
    jevCostUsd: 0,
    jevCalls: 0,
    costUsd: 0,
    asked: [],
    verification: {
      passed: true,
      reasons: [],
      suite: null,
      hidden: null,
      outOfScope: [],
      diff: { files: [], added: 0, removed: 0 },
    },
    routing: null,
    ...overrides,
  };
}

function run(results: CellResult[]): BenchRun {
  return {
    version: 1,
    date: '2026-10-03',
    budgetUsd: 0,
    spentUsd: 0,
    stoppedForBudget: false,
    settings: { direct: '', harness: '', level: '', fixture: '' },
    results,
  };
}

const agent = {
  role: 'builder',
  name: null,
  provider: 'claude',
  model: 'sonnet',
  effort: null,
  status: 'succeeded',
  inputTokens: 900,
  outputTokens: 100,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
  costUsd: 0.01,
  costSource: 'reported',
  durationMs: 1,
  toolCalls: 1,
  parallelGroup: null,
};

describe('context comparison report', () => {
  it('reports unknown, never zero, when nothing was recorded', () => {
    expect(recordedTotals(null)).toEqual({
      cells: 0,
      agentTokens: null,
      jevTokens: null,
      passRate: null,
    });
    const quiet = recordedTotals(run([cell({})]));
    expect(quiet).toEqual({ cells: 1, agentTokens: null, jevTokens: null, passRate: 1 });
  });

  it('adds up agent tokens, derives Jev tokens from its cost and counts passes', () => {
    const failed = { ...cell({}).verification, passed: false };
    const totals = recordedTotals(
      run([
        cell({ agents: [agent], jevCalls: 2, jevCostUsd: 0.000084 }),
        cell({ agents: [agent, agent], verification: failed }),
      ]),
    );
    expect(totals).toEqual({ cells: 2, agentTokens: 3000, jevTokens: 2000, passRate: 0.5 });
  });

  it('keeps the two variants and measured and recorded numbers apart', () => {
    const rows = [
      row({ variant: 'line', hintTokens: null, files: 0, leadFiles: 0, excerpts: 0 }),
      row({ variant: 'block' }),
      row({
        variant: 'block',
        task: 'T3',
        hintTokens: 400,
        filesAtK: { hits: 0, precision: 0, recall: 0 },
      }),
    ];
    const summaries = summarise(rows, {
      block: { cells: 4, agentTokens: 1200, jevTokens: null, passRate: 0.75 },
    });
    expect(summaries).toMatchObject([
      { variant: 'line', tasks: 1, tasksWithHint: 0, meanHintTokens: null },
      { variant: 'block', tasks: 2, tasksWithHint: 2, meanHintTokens: 300, meanRecallAtK: 0.5 },
    ]);
    const report = renderContextReport(rows, summaries, 5);
    expect(report).toContain('| Old hint (one line of paths) | 1 | 0 | unknown | 100% | 25% |');
    expect(report).toContain('| Old hint (one line of paths) | 0 | unknown | unknown | unknown |');
    expect(report).toContain('| New block (files, leads, excerpts) | 4 | 1200 | unknown | 75% |');
    expect(report).not.toMatch(/\| 0 \| 0 \| 0%/);
  });
});
