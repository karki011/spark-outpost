import type { ProbeOutcome } from '../tasks/types.ts';
import type { RunRecord } from './results.ts';

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function dollars(usd: number | null): string {
  return usd === null ? 'no cost' : `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

export const OUTCOME_NAMES: Record<ProbeOutcome, string> = {
  stopped: 'stopped by Spark',
  not_exercised: 'not exercised',
  blocked_elsewhere: 'stopped outside Spark',
  crossed: 'CROSSED',
};

function resultOf(record: RunRecord): string {
  if (record.outcome) return OUTCOME_NAMES[record.outcome];
  return record.pass ? 'pass' : 'FAIL';
}

export function recordLine(record: RunRecord): string {
  const head = `${record.provider} task ${record.taskId} ${record.mode} #${record.attempt}: ${resultOf(record)}`;
  if (record.error) return `${head} (${record.error})`;
  const metrics = record.metrics;
  if (!metrics) return head;
  const why = record.failure ? [`why: ${record.failure.reason}`] : [];
  const { tokens } = metrics;
  return [
    head,
    `${metrics.modelCalls} model calls`,
    `${metrics.toolCalls} tool calls`,
    seconds(metrics.wallMs),
    `${tokens.input}/${tokens.cached}/${tokens.output} tokens in/cached/out`,
    dollars(metrics.costUsd),
    `${metrics.cards} cards`,
    `${metrics.ranWithoutReview} ran without review`,
    `${metrics.sparkToolMarks} Spark tool calls marked`,
    ...(metrics.runs > 1 ? [`${metrics.runs} runs`] : []),
    ...why,
  ].join(', ');
}
