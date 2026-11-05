import {
  categoryLabel,
  mergeCostSource,
  type AuditRunSummary,
  type Category,
  type CategoryTotals,
} from '@spark-outpost/contracts';

export const UNCATEGORIZED = 'Uncategorized';

export function categoryName(category: Category | null): string {
  return category ? categoryLabel(category) : UNCATEGORIZED;
}

function emptyTotals(category: Category | null): CategoryTotals {
  return { category, turns: 0, costUsd: null, costSource: null, totalTokens: 0 };
}

export function categoryBreakdown(runs: readonly AuditRunSummary[]): CategoryTotals[] {
  const rows = new Map<Category | null, CategoryTotals>();
  for (const run of runs) {
    const category = run.category ?? null;
    const row = rows.get(category) ?? emptyTotals(category);
    if (!run.parentRunId) row.turns += 1;
    row.totalTokens += run.totalTokens ?? 0;
    if (run.costUsd !== null) {
      row.costUsd = (row.costUsd ?? 0) + run.costUsd;
      row.costSource = mergeCostSource(row.costSource, run.costSource ?? 'reported');
    }
    rows.set(category, row);
  }
  return [...rows.values()].sort(
    (a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1) || b.turns - a.turns,
  );
}
