import type { Metrics } from '../runner/metrics.ts';
import type { Provider } from '../runner/providers.ts';
import type { RunRecord } from '../runner/results.ts';
import type { ModeChoice, TaskSet } from '../tasks/types.ts';

export interface Cell {
  provider: Provider;
  taskId: string;
  taskNumber: number;
  set: TaskSet;
  mode: ModeChoice;
  runs: number;
  passes: number;
  pass: boolean;
  medians: {
    modelCalls: number | null;
    toolCalls: number | null;
    wallMs: number | null;
    inputTokens: number | null;
    cachedTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  };
  cards: number;
  ranWithoutReview: number;
  sparkToolMarks: number;
  railFlags: number;
  manyRuns: number;
  errors: number;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function passesNeeded(runs: number): number {
  return Math.ceil((2 * runs) / 3);
}

function measured(records: readonly RunRecord[]): Metrics[] {
  return records.flatMap((record) => (record.metrics ? [record.metrics] : []));
}

function cellOf(records: readonly RunRecord[]): Cell {
  const first = records[0]!;
  const metrics = measured(records);
  const mid = (pick: (item: Metrics) => number | null) =>
    median(metrics.map(pick).filter((value): value is number => value !== null));
  const total = (pick: (item: Metrics) => number) =>
    metrics.reduce((sum, item) => sum + pick(item), 0);
  const passes = records.filter((record) => record.pass).length;
  return {
    provider: first.provider,
    taskId: first.taskId,
    taskNumber: first.taskNumber,
    set: first.set,
    mode: first.mode,
    runs: records.length,
    passes,
    pass: passes >= passesNeeded(records.length),
    medians: {
      modelCalls: mid((item) => item.modelCalls),
      toolCalls: mid((item) => item.toolCalls),
      wallMs: mid((item) => item.wallMs),
      inputTokens: mid((item) => item.tokens.input),
      cachedTokens: mid((item) => item.tokens.cached),
      outputTokens: mid((item) => item.tokens.output),
      costUsd: mid((item) => item.costUsd),
    },
    cards: total((item) => item.cards),
    ranWithoutReview: total((item) => item.ranWithoutReview),
    sparkToolMarks: total((item) => item.sparkToolMarks ?? 0),
    railFlags: total((item) => item.railFlags),
    manyRuns: metrics.filter((item) => item.runs > 1).length,
    errors: records.filter((record) => record.error !== null).length,
  };
}

export function cellsOf(records: readonly RunRecord[]): Cell[] {
  const groups = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = `${record.provider} ${record.taskId} ${record.mode}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()].map(cellOf);
}

export function cellFor(
  cells: readonly Cell[],
  provider: Provider,
  taskId: string,
  mode: ModeChoice = 'auto',
): Cell | null {
  return (
    cells.find(
      (cell) => cell.provider === provider && cell.taskId === taskId && cell.mode === mode,
    ) ?? null
  );
}
