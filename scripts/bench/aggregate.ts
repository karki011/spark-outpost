import { BENCH_MODES, type AgentUsage, type BenchMode, type CellResult } from './results.ts';
import type { BenchTaskId } from './tasks.ts';

export interface Stat {
  mean: number;
  min: number;
  max: number;
}

export interface CellSummary {
  task: BenchTaskId;
  mode: BenchMode;
  runs: number;
  passed: number;
  wallMs: Stat;
  activeMs: Stat;
  costUsd: Stat;
  jevCostUsd: Stat;
  tokens: Stat;
  agents: Stat;
  toolCalls: Stat;
  diffLines: Stat;
  models: string[];
}

export interface ModeTotals {
  mode: BenchMode;
  runs: number;
  passed: number;
  wallMs: number;
  activeMs: number;
  costUsd: number;
  jevCostUsd: number;
  tokens: number;
  agents: number;
}

export interface TaskComparison {
  task: BenchTaskId;
  costRatio: number | null;
  wallRatio: number | null;
  directPassRate: number | null;
  harnessPassRate: number | null;
}

export interface Summary {
  cells: CellSummary[];
  totals: ModeTotals[];
  comparisons: TaskComparison[];
  spentUsd: number;
}

export function stat(values: readonly number[]): Stat {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  const sum = values.reduce((total, value) => total + value, 0);
  return { mean: sum / values.length, min: Math.min(...values), max: Math.max(...values) };
}

export function processedTokens(agent: AgentUsage): number {
  const cacheSeparate = agent.provider === 'claude';
  const cached = cacheSeparate ? agent.cachedReadTokens + agent.cachedWriteTokens : 0;
  return agent.inputTokens + agent.outputTokens + cached;
}

export function tokensOf(result: CellResult): number {
  return result.agents.reduce((sum, agent) => sum + processedTokens(agent), 0);
}

function diffLines(result: CellResult): number {
  return result.verification.diff.added + result.verification.diff.removed;
}

function modelLabel(agent: CellResult['agents'][number]): string {
  return `${agent.role}:${agent.model ?? agent.provider}`;
}

function summarise(task: BenchTaskId, mode: BenchMode, results: CellResult[]): CellSummary {
  const pick = (value: (result: CellResult) => number) => stat(results.map(value));
  return {
    task,
    mode,
    runs: results.length,
    passed: results.filter((result) => result.verification.passed).length,
    wallMs: pick((result) => result.wallMs),
    activeMs: pick((result) => result.activeMs),
    costUsd: pick((result) => result.costUsd),
    jevCostUsd: pick((result) => result.jevCostUsd),
    tokens: pick(tokensOf),
    agents: pick((result) => result.agents.length),
    toolCalls: pick((result) => result.toolCalls),
    diffLines: pick(diffLines),
    models: [...new Set(results.flatMap((result) => result.agents.map(modelLabel)))],
  };
}

function totalsFor(mode: BenchMode, results: CellResult[]): ModeTotals {
  const sum = (value: (result: CellResult) => number) =>
    results.reduce((total, result) => total + value(result), 0);
  return {
    mode,
    runs: results.length,
    passed: results.filter((result) => result.verification.passed).length,
    wallMs: sum((result) => result.wallMs),
    activeMs: sum((result) => result.activeMs),
    costUsd: sum((result) => result.costUsd),
    jevCostUsd: sum((result) => result.jevCostUsd),
    tokens: sum(tokensOf),
    agents: sum((result) => result.agents.length),
  };
}

function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator === undefined || denominator === undefined || denominator === 0) return null;
  return numerator / denominator;
}

function compare(task: BenchTaskId, cells: readonly CellSummary[]): TaskComparison {
  const direct = cells.find((cell) => cell.task === task && cell.mode === 'direct');
  const harness = cells.find((cell) => cell.task === task && cell.mode === 'harness');
  const passRate = (cell: CellSummary | undefined) => (cell ? cell.passed / cell.runs : null);
  return {
    task,
    costRatio: ratio(harness?.costUsd.mean, direct?.costUsd.mean),
    wallRatio: ratio(harness?.wallMs.mean, direct?.wallMs.mean),
    directPassRate: passRate(direct),
    harnessPassRate: passRate(harness),
  };
}

export function aggregate(results: readonly CellResult[]): Summary {
  const tasks = [...new Set(results.map((result) => result.task))].sort();
  const cells: CellSummary[] = [];
  for (const task of tasks) {
    for (const mode of BENCH_MODES) {
      const matching = results.filter((result) => result.task === task && result.mode === mode);
      if (matching.length > 0) cells.push(summarise(task, mode, matching));
    }
  }
  const totals = BENCH_MODES.map((mode) =>
    totalsFor(
      mode,
      results.filter((result) => result.mode === mode),
    ),
  ).filter((total) => total.runs > 0);
  return {
    cells,
    totals,
    comparisons: tasks.map((task) => compare(task, cells)),
    spentUsd: results.reduce((total, result) => total + result.costUsd, 0),
  };
}

export function projectedCostUsd(
  results: readonly CellResult[],
  task: BenchTaskId,
  mode: BenchMode,
  fallbackUsd: number,
): number {
  const seen = results
    .filter((result) => result.task === task && result.mode === mode)
    .map((result) => result.costUsd);
  return seen.length > 0 ? Math.max(...seen) * 1.25 : fallbackUsd;
}
