import type { ProviderTotals, SpendSummary } from '@spark-outpost/contracts';
import { formatTokens } from '../chat/composer/model-options.ts';

export function activityLine(summary: Pick<SpendSummary, 'runs' | 'totalTokens'>): string {
  const runs = `${summary.runs} ${summary.runs === 1 ? 'run' : 'runs'}`;
  return `${runs} · ${formatTokens(summary.totalTokens)} tokens`;
}

export function costSlices(summary: Pick<SpendSummary, 'byProvider'>): ProviderTotals[] {
  return summary.byProvider
    .filter((row) => row.costUsd !== null && row.costUsd > 0)
    .toSorted((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
}
