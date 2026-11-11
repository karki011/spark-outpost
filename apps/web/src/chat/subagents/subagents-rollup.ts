import type { SubagentRow } from '@spark-outpost/contracts';
import { workerPresentation, workerRole } from '../../crew/worker-identity.ts';
import { countLabel } from '../../ui/count-label.ts';

const ROLLUP_THRESHOLD = 4;

const STATE_ORDER = ['done', 'working', 'inactive', 'failed', 'stopped'] as const;

export interface Rollup {
  text: string;
}

const roleLabel = (row: Pick<SubagentRow, 'name'>) => workerRole(row.name) ?? 'Agent';

function tally(labels: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return counts;
}

export function rollupRoles(rows: readonly Pick<SubagentRow, 'name'>[]): string {
  return [...tally(rows.map(roleLabel))].map(([role, count]) => countLabel(count, role)).join(', ');
}

export function rollupStates(rows: readonly Pick<SubagentRow, 'state'>[], live: boolean): string {
  const counts = tally(rows.map((row) => workerPresentation(row.state, live).label.toLowerCase()));
  return STATE_ORDER.filter((label) => counts.has(label))
    .map((label) => `${counts.get(label)} ${label}`)
    .join(' · ');
}

export function rollupRows(rows: readonly SubagentRow[], live: boolean): Rollup | null {
  if (rows.length <= ROLLUP_THRESHOLD) return null;
  return {
    text: `${rollupRoles(rows)} · ${rollupStates(rows, live)}`,
  };
}
