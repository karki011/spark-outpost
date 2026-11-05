import type { ModelStat } from '@spark-outpost/contracts';

export const ANECDOTAL_BELOW = 3;

export interface StatLine {
  key: string;
  label: string;
  n: number;
  passed: number;
  meanCostUsd: number;
  meanWallMs: number;
  estimated: boolean;
  rounds: string[];
  anecdotal: boolean;
}

const ROLE_WORDS: Record<ModelStat['role'], string> = {
  direct: 'alone',
  scout: 'as Reader',
  architect: 'as Architect',
  builder: 'as Builder',
  critic: 'as Critic',
};

export function statLines(stats: readonly ModelStat[]): StatLine[] {
  const groups = new Map<string, ModelStat[]>();
  for (const stat of stats) {
    const key = `${stat.category}|${stat.role}|${stat.effort ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), stat]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const first = rows[0]!;
      const n = rows.reduce((sum, row) => sum + row.n, 0);
      const weighted = (pick: (row: ModelStat) => number) =>
        rows.reduce((sum, row) => sum + pick(row) * row.n, 0) / n;
      const effort = first.effort ? ` · ${first.effort}` : '';
      return {
        key,
        label: `${first.category} ${ROLE_WORDS[first.role]}${effort}`,
        n,
        passed: rows.reduce((sum, row) => sum + row.passed, 0),
        meanCostUsd: weighted((row) => row.meanCostUsd),
        meanWallMs: weighted((row) => row.meanWallMs),
        estimated: rows.some((row) => row.costSource !== 'reported'),
        rounds: [...new Set(rows.map((row) => row.round))].sort(),
        anecdotal: n < ANECDOTAL_BELOW,
      };
    })
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

export function formatTokenCount(tokens: number): string {
  return tokens >= 1_000_000
    ? `${Number((tokens / 1_000_000).toFixed(2))}M`
    : `${Math.round(tokens / 1000)}K`;
}

export function formatPrice(value: number): string {
  return `$${Number(value.toFixed(3))}`;
}
