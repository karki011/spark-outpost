import type {
  RunStatus,
  SparkActivity,
  SparkActivityKind,
  SparkUsage,
  UsageTotals,
} from '@spark-outpost/contracts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { relativeTime } from '../ui/relative-time.ts';
import { formatCost } from '../usage/format.ts';

const NOUNS: Record<SparkActivityKind, readonly [string, string]> = {
  chat: ['chat', 'chats'],
  job: ['@ job', '@ jobs'],
  step: ['workflow step', 'workflow steps'],
};

const ACTIVITY_WORDS: Record<SparkActivityKind, string> = {
  chat: 'Chat',
  job: '@ job',
  step: 'Workflow step',
};

const STATUS_WORDS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Working',
  awaiting_approval: 'Needs you',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
  outcome_unknown: 'Outcome unknown',
};

export function countLabel(kind: SparkActivityKind, count: number): string {
  const [one, many] = NOUNS[kind];
  return `${count} ${count === 1 ? one : many}`;
}

export function spendParts(totals: Pick<UsageTotals, 'tokens' | 'costUsd'>): string[] {
  const parts: string[] = [];
  if (totals.tokens > 0) parts.push(`${formatTokens(totals.tokens)} tokens`);
  if (totals.costUsd !== null) parts.push(formatCost(totals.costUsd));
  return parts;
}

export function totalsLine(totals: UsageTotals, now: number): string {
  if (totals.count === 0 || totals.lastAt === null) return 'Not used yet';
  return [`last ${relativeTime(totals.lastAt, now)}`, ...spendParts(totals)].join(' · ');
}

export function activityLine(entry: SparkActivity, now: number): string {
  const kind = entry.workflowName
    ? `${ACTIVITY_WORDS[entry.kind]} in ${entry.workflowName}`
    : ACTIVITY_WORDS[entry.kind];
  const status = entry.status ? [STATUS_WORDS[entry.status]] : [];
  return [kind, ...status, relativeTime(entry.at, now), ...spendParts(entry)].join(' · ');
}

export function usedAnywhere(usage: SparkUsage): boolean {
  return usage.workflows.length > 0 || usage.sparks.length > 0;
}

export function wordCount(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

export function wordsLabel(text: string): string {
  const words = wordCount(text);
  return `${words} ${words === 1 ? 'word' : 'words'}`;
}

export function defaultSparkHint(
  spark: { id: string; name: string },
  current: { id: string; name: string } | null,
): string {
  const rule = 'Every new chat starts as this Spark. One Spark at a time.';
  if (!current) return `${rule} Now: no Spark.`;
  if (current.id === spark.id) return `${rule} Now: ${spark.name}.`;
  return `${rule} Now: ${current.name}.`;
}
