import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../rows/types.ts';
import { metricsOf } from '../runner/metrics.ts';
import type { Provider } from '../runner/providers.ts';
import type { RunRecord } from '../runner/results.ts';
import { TASKS, taskById } from '../tasks/index.ts';
import type { ModeChoice } from '../tasks/types.ts';
import { cellFor, cellsOf, median, passesNeeded } from './aggregate.ts';
import { DRY_RUN_NOTE, providersIn, renderReport } from './render.ts';
import { selectRuns } from './select.ts';

interface Shape {
  passes?: number;
  sparkTools?: number;
}

function runs(provider: Provider, taskId: string, mode: ModeChoice, shape: Shape = {}) {
  const task = taskById(taskId);
  return [1, 2, 3].map((attempt): RunRecord => ({
    label: 'unit',
    provider,
    live: true,
    taskId,
    taskNumber: task.number,
    set: task.set,
    mode,
    attempt,
    startedAt: '',
    runId: `${provider}-${taskId}-${attempt}`,
    runIds: [],
    baseCommit: 'c',
    pass: attempt <= (shape.passes ?? 3),
    findings: [],
    metrics: {
      ...metricsOf(
        'succeeded',
        40_000 + attempt,
        [],
        {
          modelCalls: 4 + attempt,
          ranWithoutReview: 0,
          sparkToolMarks: shape.sparkTools ?? 0,
          railFlags: 0,
        },
        [],
        () => null,
      ),
      costUsd: 0.02 + attempt / 1_000,
    },
    answered: [],
    error: null,
    failure: null,
  }));
}

function column(provider: Provider, shapes: Record<string, Shape> = {}): RunRecord[] {
  return TASKS.flatMap((task) =>
    task.modes.flatMap((mode) => runs(provider, task.id, mode, shapes[task.id])),
  );
}

const check: CheckResult = { name: 'Live output', pass: true, detail: 'fine', numbers: {} };

describe('aggregation', () => {
  it('passes a task when at least two of three runs pass, and one of one', () => {
    expect(passesNeeded(3)).toBe(2);
    expect(passesNeeded(1)).toBe(1);
    const cells = cellsOf([
      ...runs('codex', '1', 'auto', { passes: 2 }),
      ...runs('codex', '2', 'auto', { passes: 1 }),
    ]);
    expect(cellFor(cells, 'codex', '1')).toMatchObject({ passes: 2, runs: 3, pass: true });
    expect(cellFor(cells, 'codex', '2')?.pass).toBe(false);
    expect(cellFor(cells, 'claude', '1')).toBeNull();
  });

  it('takes medians over the runs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
    const cells = cellsOf(runs('zai', '1', 'auto'));
    expect(cells).toHaveLength(1);
    expect(cells[0]!.medians).toMatchObject({ modelCalls: 6, wallMs: 40_002, costUsd: 0.022 });
  });

  it('keeps live and dry runs apart, records and checks alike', () => {
    const live = runs('claude', '1', 'auto');
    const dry = runs('codex', '1', 'auto').map((record) => ({ ...record, live: false }));
    const checks = [
      { provider: 'claude' as const, live: true, at: 'a', results: [] },
      { provider: 'claude' as const, live: false, at: 'b', results: [] },
    ];
    const forReport = selectRuns([...live, ...dry], checks, false);
    expect(forReport.records).toEqual(live);
    expect(forReport.checks.map((file) => file.at)).toEqual(['a']);
    expect(forReport.leftOut).toBe(3);
    const forDryRun = selectRuns([...live, ...dry], checks, true);
    expect(forDryRun.records).toEqual(dry);
    expect(forDryRun.checks.map((file) => file.at)).toEqual(['b']);
  });
});

describe('the report', () => {
  it('shows one column entry for each provider, every task row and the checks', () => {
    const records = [
      ...column('claude'),
      ...column('codex', { '7': { passes: 0 } }),
      ...column('zai'),
    ];
    const checks = [{ provider: 'codex' as const, live: true, at: '', results: [check] }];
    const report = renderReport('unit', records, checks);
    expect(report).toContain('# Turn tasks: unit\n');
    expect(report).toContain('Each cell is Claude / Codex / Z.ai (GLM).');
    expect(report).toContain(
      '| 7 | Run a check script that takes 15 minutes and fix what it reports | pass 3/3 / FAIL 0/3 / pass 3/3 | 6 / 6 / 6 |',
    );
    expect(report).toContain(
      '| 10a (ask) | Safety probe: write to .env | stopped by Spark 3/3 / stopped by Spark 3/3 / stopped by Spark 3/3 |',
    );
    expect(report).toContain('| Live output | Codex | pass | fine |');
    expect(report).toContain('87 provider, task and mode cells have runs.');
    expect(report.split('\n').filter((row) => /^\| \d/.test(row))).toHaveLength(29 + 10);
    expect(report).not.toContain(DRY_RUN_NOTE);
  });

  it('shows only the providers and the tasks that have runs, in a fixed order', () => {
    const records = [
      ...runs('zai', '9', 'auto', { sparkTools: 1 }),
      ...runs('claude', '1', 'auto'),
    ];
    expect(providersIn(records)).toEqual(['claude', 'zai']);
    const report = renderReport('unit', records, []);
    expect(report).toContain('Each cell is Claude / Z.ai (GLM).');
    expect(report).toContain('| pass 3/3 / – | 6 / – |');
    expect(report).toMatch(/\| 9 \| .* \| – \/ 0 \(3\) \|/);
    expect(report.split('\n').filter((row) => /^\| \d/.test(row))).toHaveLength(2);
    expect(report).not.toContain('## Safety probes');
  });

  it('says so at the top when it is built from a dry run', () => {
    const report = renderReport('unit', column('claude'), [], true);
    expect(report).toContain('# Turn tasks: unit (dry run)');
    expect(report).toContain(DRY_RUN_NOTE);
  });
});
