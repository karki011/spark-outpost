import { redactText } from '../../../packages/contracts/src/index.ts';
import { fields, type LogRow } from '../rows/types.ts';

export interface RunOutcome {
  runId: string;
  status: string;
  error: string | null;
  details: string | null;
}

export interface AgentError {
  method: string | null;
  message: string;
}

export interface Failure {
  reason: string;
}

const SUCCEEDED = 'succeeded';
const MAX_TEXT = 600;
const MAX_REPLY = 200;
const NEEDS_YOU = /^Needs you:/;

function clip(text: string, max: number = MAX_TEXT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function agentErrorsIn(rows: readonly LogRow[]): AgentError[] {
  return rows.flatMap((row) => {
    if (row.direction !== 'from_agent' || row.kind !== 'error') return [];
    const message = fields(fields(row.payload).error).message;
    return typeof message === 'string' ? [{ method: row.method, message }] : [];
  });
}

function runLines(runs: readonly RunOutcome[]): string[] {
  const groups = new Map<string, { count: number; run: RunOutcome }>();
  for (const run of runs) {
    if (run.status === SUCCEEDED && run.error === null) continue;
    const key = `${run.status}\n${run.error ?? ''}`;
    const group = groups.get(key) ?? { count: 0, run };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map(({ count, run }) => {
    const why = run.error === null ? 'Spark recorded no reason' : clip(run.error);
    const more = run.details !== null && run.details !== run.error ? ` [${clip(run.details)}]` : '';
    return `${count} run${count === 1 ? '' : 's'} ${run.status}: ${why}${more}`;
  });
}

function agentLines(errors: readonly AgentError[]): string[] {
  const said = new Set(
    errors.map(
      (error) => `the agent answered ${error.method ?? 'a request'} with: ${clip(error.message)}`,
    ),
  );
  return [...said];
}

export function failureOf(
  runs: readonly RunOutcome[],
  agentErrors: readonly AgentError[],
  reply: string,
): Failure | null {
  const lines = [...runLines(runs), ...agentLines(agentErrors)];
  if (lines.length === 0) return null;
  if (NEEDS_YOU.test(reply)) lines.push(`Spark replied: ${clip(reply, MAX_REPLY)}`);
  return { reason: redactText(lines.join('; ')) };
}
