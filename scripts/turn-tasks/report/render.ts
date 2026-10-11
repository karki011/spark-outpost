import { wasObserved } from '../checks/command-output.ts';
import type { CheckResult } from '../rows/types.ts';
import { PROVIDERS, PROVIDER_SETUPS, type Provider } from '../runner/providers.ts';
import type { CheckFile, RunRecord } from '../runner/results.ts';
import { dollars, seconds } from '../runner/summary.ts';
import { TASKS } from '../tasks/index.ts';
import { cellFor, cellsOf, type Cell } from './aggregate.ts';
import { probeSection } from './probe-section.ts';
import { outcomeCounts } from './probes.ts';

const NONE = '–';

export function providersIn(records: readonly RunRecord[]): Provider[] {
  return PROVIDERS.filter((provider) => records.some((record) => record.provider === provider));
}

function nameOf(provider: Provider): string {
  return PROVIDER_SETUPS[provider].name;
}

function whole(value: number | null): string {
  return value === null ? NONE : String(Math.round(value));
}

function each(cells: readonly (Cell | null)[], show: (cell: Cell) => string): string {
  return cells.map((cell) => (cell ? show(cell) : NONE)).join(' / ');
}

function runsOf(records: readonly RunRecord[], provider: Provider, taskId: string, mode: string) {
  return records.filter(
    (record) => record.provider === provider && record.taskId === taskId && record.mode === mode,
  );
}

function taskRows(
  cells: readonly Cell[],
  records: readonly RunRecord[],
  providers: readonly Provider[],
): string[] {
  return TASKS.flatMap((task) =>
    task.modes.flatMap((mode) => {
      const row = providers.map((provider) => cellFor(cells, provider, task.id, mode));
      if (row.every((cell) => cell === null)) return [];
      const columns = [
        `${task.id}${task.set === 'safety' ? ` (${mode})` : ''}`,
        task.title,
        task.set === 'safety'
          ? providers
              .map((provider) => outcomeCounts(runsOf(records, provider, task.id, mode)) || NONE)
              .join(' / ')
          : each(row, (cell) => `${cell.pass ? 'pass' : 'FAIL'} ${cell.passes}/${cell.runs}`),
        each(row, (cell) => whole(cell.medians.modelCalls)),
        each(row, (cell) => whole(cell.medians.toolCalls)),
        each(row, (cell) => (cell.medians.wallMs === null ? NONE : seconds(cell.medians.wallMs))),
        each(
          row,
          (cell) =>
            `${whole(cell.medians.inputTokens)}, ${whole(cell.medians.cachedTokens)}, ${whole(cell.medians.outputTokens)}`,
        ),
        each(row, (cell) => (cell.medians.costUsd === null ? NONE : dollars(cell.medians.costUsd))),
        each(row, (cell) => String(cell.cards)),
        each(row, (cell) => `${cell.ranWithoutReview} (${cell.sparkToolMarks})`),
      ];
      return [`| ${columns.join(' | ')} |`];
    }),
  );
}

function outcome(check: CheckResult): string {
  if (!wasObserved(check)) return 'not observed';
  return check.pass ? 'pass' : 'FAIL';
}

function checkRows(files: readonly CheckFile[]): string[] {
  return files.flatMap((file) =>
    file.results.map(
      (check) =>
        `| ${check.name} | ${nameOf(file.provider)} | ${outcome(check)} | ${check.detail} |`,
    ),
  );
}

function notes(cells: readonly Cell[]): string[] {
  const name = (cell: Cell) => `${nameOf(cell.provider)} task ${cell.taskId} (${cell.mode})`;
  return [
    `- ${cells.length} provider, task and mode cells have runs.`,
    ...cells
      .filter((cell) => cell.manyRuns > 0)
      .map((cell) => `- ${name(cell)}: ${cell.manyRuns} turns held more than one run.`),
    ...cells
      .filter((cell) => cell.errors > 0)
      .map(
        (cell) => `- ${name(cell)}: ${cell.errors} runs ended with an error and count as failed.`,
      ),
    ...cells
      .filter((cell) => cell.railFlags > 0)
      .map((cell) => `- ${name(cell)}: ${cell.railFlags} crossed-rail flags.`),
  ];
}

export const DRY_RUN_NOTE =
  "Dry run: no provider call was made. Spark's fake agent stood in for every provider. The numbers prove the pipeline, not the models.";

export function renderReport(
  label: string,
  records: readonly RunRecord[],
  checks: readonly CheckFile[],
  dryRun = false,
): string {
  const cells = cellsOf(records);
  const providers = providersIn(records);
  const names = providers.map(nameOf).join(' / ') || 'no provider';
  return [
    `# Turn tasks: ${label}${dryRun ? ' (dry run)' : ''}`,
    '',
    ...(dryRun ? [DRY_RUN_NOTE, ''] : []),
    '## Tasks',
    '',
    `Each cell is ${names}. Numbers are medians over the runs of a task; cards and "ran without review" are totals. A safety probe shows its outcome, not pass or fail. The number in brackets counts Spark tool calls, which Spark marks because its own tools are not asked about. Cost is what Spark recorded, or the list price where the agent reported none. Nothing was capped.`,
    '',
    '| Task | What | Pass (runs passed) | Model calls | Tool calls | Wall time | Tokens in, cached, out | Cost | Cards | Ran without review (Spark tools) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...taskRows(cells, records, providers),
    '',
    ...probeSection(records, providers),
    '## Checks',
    '',
    '| Check | Provider | Result | Numbers |',
    '| --- | --- | --- | --- |',
    ...checkRows(checks),
    '',
    '## Notes',
    '',
    ...notes(cells),
    '',
  ].join('\n');
}
