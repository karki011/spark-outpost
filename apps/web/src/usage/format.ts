import type { Run, RunUsage, TokenUsage, TotalCostSource } from '@spark-outpost/contracts';
import { formatTokens } from '../chat/composer/model-options.ts';

export type CostSourceLabel = TotalCostSource | null | undefined;

export const ESTIMATE_TIP =
  'Estimated from tokens × the published list price. The provider did not report a cost.';
export const MIXED_TIP = 'Includes estimated costs for replies whose provider did not report one.';

export function formatCost(usd: number, source?: CostSourceLabel): string {
  let amount = `$${usd.toFixed(2)}`;
  if (usd === 0) amount = '$0.00';
  else if (usd < 0.001) amount = '<$0.001';
  else if (usd < 0.01) amount = `$${usd.toFixed(3)}`;
  return source === 'estimated' ? `~${amount}` : amount;
}

export function costNote(source: CostSourceLabel): string | null {
  if (source === 'estimated') return 'estimated';
  if (source === 'mixed') return 'includes estimates';
  return null;
}

export function costTip(source: CostSourceLabel): string | undefined {
  if (source === 'estimated') return ESTIMATE_TIP;
  if (source === 'mixed') return MIXED_TIP;
  return undefined;
}

export function usageLine(
  tokens: number | null,
  costUsd: number | null,
  source?: CostSourceLabel,
): string | null {
  const parts: string[] = [];
  if (tokens !== null) parts.push(`${formatTokens(tokens)} tokens`);
  if (costUsd !== null) parts.push(formatCost(costUsd, source));
  if (costUsd !== null && source === 'mixed') parts.push('includes estimates');
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function runUsageLine(usage: RunUsage | null): string | null {
  if (!usage) return null;
  return usageLine(usage.tokens?.total ?? null, usage.costUsd, usage.costSource);
}

export function tokenBreakdown(tokens: TokenUsage): string[] {
  const optional: [string, number | null][] = [
    ['Cached read', tokens.cachedRead],
    ['Cached write', tokens.cachedWrite],
    ['Thinking', tokens.thought],
  ];
  return [
    `Input ${formatTokens(tokens.input)}`,
    `Output ${formatTokens(tokens.output)}`,
    ...optional
      .filter((entry): entry is [string, number] => entry[1] !== null && entry[1] > 0)
      .map(([label, count]) => `${label} ${formatTokens(count)}`),
  ];
}

export function contextPercent(used: number | null, size: number | null): number {
  if (used === null || size === null || size <= 0) return 0;
  return Math.min(100, Math.round((used / size) * 100));
}

export interface ContextReading {
  used: number;
  size: number;
}

function contextOf(run: Run | undefined): ContextReading | null {
  const usage = run?.usage;
  if (!usage || usage.contextUsed === null || usage.contextSize === null) return null;
  return { used: usage.contextUsed, size: usage.contextSize };
}

function lastReading(runs: readonly Run[], matches: (run: Run) => boolean): ContextReading | null {
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    const reading = run && matches(run) ? contextOf(run) : null;
    if (reading) return reading;
  }
  return null;
}

export function latestContext(
  runs: readonly Run[],
  provider: string | null,
): ContextReading | null {
  return lastReading(runs, (run) => run.provider === provider) ?? lastReading(runs, () => true);
}
