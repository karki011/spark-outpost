import type { AuditRunSummary } from '@spark-outpost/contracts';

type Cell = string | number | boolean | null;

const COLUMNS: readonly [string, (run: AuditRunSummary) => Cell][] = [
  ['run_id', (run) => run.runId],
  ['created_at', (run) => run.createdAt],
  ['role', (run) => run.role],
  ['provider', (run) => run.provider],
  ['model', (run) => run.model],
  ['effort', (run) => run.effort],
  ['mode', (run) => run.runMode],
  ['status', (run) => run.status],
  ['input_tokens', (run) => run.inputTokens],
  ['output_tokens', (run) => run.outputTokens],
  ['cached_read_tokens', (run) => run.cachedReadTokens],
  ['cached_write_tokens', (run) => run.cachedWriteTokens],
  ['thinking_tokens', (run) => run.thoughtTokens],
  ['total_tokens', (run) => run.totalTokens],
  ['cost_usd', (run) => run.costUsd],
  ['cost_source', (run) => (run.costUsd === null ? 'not_reported' : run.costSource)],
  ['duration_ms', (run) => run.durationMs],
  ['tool_calls', (run) => run.toolCallCount],
];

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function costCsv(runs: readonly AuditRunSummary[]): string {
  const header = COLUMNS.map(([name]) => name).join(',');
  const lines = runs.map((run) => COLUMNS.map(([, read]) => csvCell(read(run))).join(','));
  return `${[header, ...lines].join('\r\n')}\r\n`;
}
