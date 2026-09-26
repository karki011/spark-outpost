import type { BudgetLimit } from '@spark-outpost/contracts';

export interface BudgetLimits {
  activeLimitMs: number;
  toolCallLimit: number;
  costCapUsd: number | null;
}

export interface BudgetUsage {
  activeMs: number;
  toolCalls: number;
  costUsd: number;
}

export function activeTime(elapsedMs: number, waitedMs: number): number {
  return Math.max(0, Math.round(elapsedMs - waitedMs));
}

export function coveredMs(spans: readonly (readonly [number, number])[]): number {
  const sorted = [...spans].sort(([a], [b]) => a - b);
  let total = 0;
  let end = -Infinity;
  for (const [start, finish] of sorted) {
    const from = Math.max(start, end);
    if (finish > from) total += finish - from;
    end = Math.max(end, finish);
  }
  return total;
}

export function exceededLimit(usage: BudgetUsage, limits: BudgetLimits): BudgetLimit | null {
  if (usage.activeMs >= limits.activeLimitMs) return 'time';
  if (usage.toolCalls >= limits.toolCallLimit) return 'tool_calls';
  if (limits.costCapUsd !== null && usage.costUsd >= limits.costCapUsd) return 'cost';
  return null;
}

export function extendLimits(
  limits: BudgetLimits,
  usage: BudgetUsage,
  base: BudgetLimits,
): BudgetLimits {
  return {
    activeLimitMs: Math.max(limits.activeLimitMs, usage.activeMs + base.activeLimitMs),
    toolCallLimit: Math.max(limits.toolCallLimit, usage.toolCalls + base.toolCallLimit),
    costCapUsd:
      limits.costCapUsd === null || base.costCapUsd === null
        ? limits.costCapUsd
        : Math.max(limits.costCapUsd, usage.costUsd + base.costCapUsd),
  };
}

export function usedAndAllowed(
  limit: BudgetLimit,
  usage: BudgetUsage,
  limits: BudgetLimits,
): { used: number; allowed: number } {
  if (limit === 'time') return { used: usage.activeMs, allowed: limits.activeLimitMs };
  if (limit === 'tool_calls') return { used: usage.toolCalls, allowed: limits.toolCallLimit };
  return { used: usage.costUsd, allowed: limits.costCapUsd ?? 0 };
}
