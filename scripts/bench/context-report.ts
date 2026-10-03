import { JEV_INPUT_USD_PER_MILLION } from '../../apps/server/src/advisor/jev.ts';
import type { AtK } from '../../apps/server/src/routing/labels.ts';
import type { BenchRun } from './results.ts';

export type ContextVariant = 'line' | 'block';

export const CONTEXT_VARIANTS: readonly ContextVariant[] = ['line', 'block'];

export const VARIANT_NAMES: Record<ContextVariant, string> = {
  line: 'Old hint (one line of paths)',
  block: 'New block (files, leads, excerpts)',
};

export interface ContextRow {
  task: string;
  variant: ContextVariant;
  hintTokens: number | null;
  files: number;
  leadFiles: number;
  excerpts: number;
  filesAtK: AtK;
}

export interface RecordedTotals {
  cells: number;
  agentTokens: number | null;
  jevTokens: number | null;
  passRate: number | null;
}

export interface VariantSummary {
  variant: ContextVariant;
  tasks: number;
  tasksWithHint: number;
  meanHintTokens: number | null;
  meanRecallAtK: number | null;
  meanPrecisionAtK: number | null;
  recorded: RecordedTotals;
}

export const NOTHING_RECORDED: RecordedTotals = {
  cells: 0,
  agentTokens: null,
  jevTokens: null,
  passRate: null,
};

function mean(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) return null;
  return known.reduce((sum, value) => sum + value, 0) / known.length;
}

export function recordedTotals(run: BenchRun | null): RecordedTotals {
  const cells = run?.results ?? [];
  if (cells.length === 0) return NOTHING_RECORDED;
  const agentTokens = cells
    .flatMap((cell) => cell.agents)
    .reduce((sum, agent) => sum + agent.inputTokens + agent.outputTokens, 0);
  const asked = cells.some((cell) => cell.jevCalls > 0);
  const jevCost = cells.reduce((sum, cell) => sum + cell.jevCostUsd, 0);
  return {
    cells: cells.length,
    agentTokens: cells.some((cell) => cell.agents.length > 0) ? agentTokens : null,
    jevTokens: asked ? Math.round((jevCost * 1_000_000) / JEV_INPUT_USD_PER_MILLION) : null,
    passRate: cells.filter((cell) => cell.verification.passed).length / cells.length,
  };
}

export function summarise(
  rows: readonly ContextRow[],
  recorded: Partial<Record<ContextVariant, RecordedTotals>>,
): VariantSummary[] {
  return CONTEXT_VARIANTS.map((variant) => {
    const own = rows.filter((row) => row.variant === variant);
    return {
      variant,
      tasks: own.length,
      tasksWithHint: own.filter((row) => row.hintTokens !== null).length,
      meanHintTokens: mean(own.map((row) => row.hintTokens)),
      meanRecallAtK: mean(own.map((row) => row.filesAtK.recall)),
      meanPrecisionAtK: mean(own.map((row) => row.filesAtK.precision)),
      recorded: recorded[variant] ?? NOTHING_RECORDED,
    };
  });
}

export function shown(value: number | null, digits = 0): string {
  return value === null ? 'unknown' : value.toFixed(digits);
}

function percent(value: number | null): string {
  return value === null ? 'unknown' : `${(value * 100).toFixed(0)}%`;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

export function renderContextReport(
  rows: readonly ContextRow[],
  summaries: readonly VariantSummary[],
  k: number,
): string {
  const measured = table(
    ['Variant', 'Tasks', 'With a hint', 'Hint tokens (mean)', `Recall@${k}`, `Precision@${k}`],
    summaries.map((summary) => [
      VARIANT_NAMES[summary.variant],
      String(summary.tasks),
      String(summary.tasksWithHint),
      shown(summary.meanHintTokens),
      percent(summary.meanRecallAtK),
      percent(summary.meanPrecisionAtK),
    ]),
  );
  const recorded = table(
    ['Variant', 'Recorded cells', 'Agent tokens', 'Jev tokens', 'Pass rate'],
    summaries.map((summary) => [
      VARIANT_NAMES[summary.variant],
      String(summary.recorded.cells),
      shown(summary.recorded.agentTokens),
      shown(summary.recorded.jevTokens),
      percent(summary.recorded.passRate),
    ]),
  );
  const perTask = table(
    ['Task', 'Variant', 'Hint tokens', 'Files', 'Lead files', 'Excerpts', `Hits@${k}`],
    rows.map((row) => [
      row.task,
      row.variant,
      shown(row.hintTokens),
      String(row.files),
      String(row.leadFiles),
      String(row.excerpts),
      String(row.filesAtK.hits),
    ]),
  );
  return [
    '# Code context: old hint vs new block',
    '',
    '## Measured offline (no provider or Jev call)',
    'Hint tokens are estimated from the text handed to the agent; "unknown" means the variant gave no hint for any task. Files at K are scored against the files each bench task may change.',
    '',
    measured,
    '',
    '## From recorded bench runs',
    'Agent tokens, Jev tokens and pass rate come only from recorded results files. Unknown is never reported as zero.',
    '',
    recorded,
    '',
    '## Per task',
    perTask,
    '',
  ].join('\n');
}
