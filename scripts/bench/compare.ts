import { aggregate, type CellSummary } from './aggregate.ts';
import { ratio, seconds, usd } from './format.ts';
import type { BenchMode, BenchRun } from './results.ts';
import { TASKS, type BenchTaskId } from './tasks.ts';

export interface TextTable {
  head: string[];
  rows: string[][];
}

type Cells = readonly CellSummary[];

function cellOf(cells: Cells, task: BenchTaskId, mode: BenchMode): CellSummary | undefined {
  return cells.find((cell) => cell.task === task && cell.mode === mode);
}

function passText(cell: CellSummary | undefined): string {
  return cell ? `${cell.passed}/${cell.runs}` : 'n/a';
}

function costText(cell: CellSummary | undefined): string {
  return cell ? usd(cell.costUsd.mean) : 'n/a';
}

function wallText(cell: CellSummary | undefined): string {
  return cell ? seconds(cell.wallMs.mean) : 'n/a';
}

function times(numerator: number | undefined, denominator: number | undefined): string {
  if (numerator === undefined || !denominator) return 'n/a';
  return ratio(numerator / denominator);
}

export interface TuningCells {
  task: BenchTaskId;
  directBefore: CellSummary | undefined;
  before: CellSummary | undefined;
  direct: CellSummary | undefined;
  after: CellSummary | undefined;
}

export function tuningCells(baseline: BenchRun, run: BenchRun): TuningCells[] {
  const old = aggregate(baseline.results).cells;
  const now = aggregate(run.results).cells;
  const tasks = [...new Set(baseline.results.map((result) => result.task))].sort();
  return tasks.map((task) => ({
    task,
    directBefore: cellOf(old, task, 'direct'),
    before: cellOf(old, task, 'harness'),
    direct: cellOf(now, task, 'direct'),
    after: cellOf(now, task, 'harness'),
  }));
}

export function tuningTable(baseline: BenchRun, run: BenchRun): TextTable {
  const rows = tuningCells(baseline, run).map(({ task, directBefore, before, direct, after }) => [
    task,
    `${passText(directBefore)} / ${passText(direct)}`,
    `${passText(before)} / ${passText(after)}`,
    costText(direct),
    costText(before),
    costText(after),
    times(before?.costUsd.mean, directBefore?.costUsd.mean),
    times(after?.costUsd.mean, direct?.costUsd.mean),
    wallText(direct),
    wallText(before),
    wallText(after),
    times(before?.wallMs.mean, directBefore?.wallMs.mean),
    times(after?.wallMs.mean, direct?.wallMs.mean),
  ]);
  return {
    head: [
      'Task',
      'Direct pass (old / new)',
      'Harness pass (old / tuned)',
      'Direct cost',
      'Harness old',
      'Harness tuned',
      'Old cost ×',
      'Tuned cost ×',
      'Direct wall',
      'Old wall',
      'Tuned wall',
      'Old time ×',
      'Tuned time ×',
    ],
    rows,
  };
}

function criticRuns(run: BenchRun, task: BenchTaskId): string {
  const harness = run.results.filter((result) => result.task === task && result.mode === 'harness');
  const reviewed = harness.filter((result) =>
    result.agents.some((agent) => agent.role === 'critic'),
  );
  return harness.length > 0 ? `${reviewed.length}/${harness.length}` : 'n/a';
}

export function hardTable(run: BenchRun): TextTable | null {
  const cells = aggregate(run.results).cells;
  const hard = TASKS.filter(
    (task) => task.set === 'hard' && run.results.some((result) => result.task === task.id),
  );
  if (hard.length === 0) return null;
  const rows = hard.map((task) => {
    const direct = cellOf(cells, task.id, 'direct');
    const harness = cellOf(cells, task.id, 'harness');
    return [
      `${task.id} · ${task.title}`,
      passText(direct),
      passText(harness),
      costText(direct),
      costText(harness),
      times(harness?.costUsd.mean, direct?.costUsd.mean),
      wallText(direct),
      wallText(harness),
      criticRuns(run, task.id),
    ];
  });
  return {
    head: [
      'Task',
      'Direct pass',
      'Harness pass',
      'Direct cost',
      'Harness cost',
      'Cost ×',
      'Direct wall',
      'Harness wall',
      'Critic ran',
    ],
    rows,
  };
}

export function passTotals(run: BenchRun, set: 'standard' | 'hard', mode: BenchMode): string {
  const ids = new Set(TASKS.filter((task) => task.set === set).map((task) => task.id));
  const results = run.results.filter((result) => ids.has(result.task) && result.mode === mode);
  const passed = results.filter((result) => result.verification.passed).length;
  return `${passed}/${results.length}`;
}
