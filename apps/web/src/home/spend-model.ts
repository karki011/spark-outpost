import type { ProviderTotals, RoutingSavings, SpendSummary } from '@spark-outpost/contracts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { formatCost } from '../usage/format.ts';

const EVEN_USD = 0.005;

export function savingsLine(savings: RoutingSavings | null): string | null {
  if (!savings) return null;
  const amount = formatCost(Math.abs(savings.netUsd));
  if (savings.netUsd >= EVEN_USD) {
    return `Jev routing saved ≈${amount} vs always using the top model`;
  }
  if (savings.netUsd <= -EVEN_USD) {
    return `Jev routing cost ≈${amount} more than always using the top model`;
  }
  return 'Jev routing cost about the same as always using the top model';
}

export function savingsTip(savings: RoutingSavings): string {
  const turns = `${savings.runs} ${savings.runs === 1 ? 'turn' : 'turns'}`;
  return `Estimated from list prices for the same tokens over ${turns} Jev routed, after ${formatCost(savings.jevCostUsd)} for Jev itself.`;
}

export function activityLine(summary: Pick<SpendSummary, 'runs' | 'totalTokens'>): string {
  const runs = `${summary.runs} ${summary.runs === 1 ? 'run' : 'runs'}`;
  return `${runs} · ${formatTokens(summary.totalTokens)} tokens`;
}

export function costSlices(summary: Pick<SpendSummary, 'byProvider'>): ProviderTotals[] {
  return summary.byProvider
    .filter((row) => row.costUsd !== null && row.costUsd > 0)
    .toSorted((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
}
