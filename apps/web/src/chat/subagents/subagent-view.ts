import type { SubagentRow, SubagentState } from '@spark-outpost/contracts';

export interface SubagentLine {
  row: SubagentRow;
  depth: number;
}

export const SUBAGENT_STATE_WORDS: Record<SubagentState, string> = {
  working: 'Working',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function subagentLines(rows: readonly SubagentRow[]): SubagentLine[] {
  const known = new Set(rows.map((row) => row.id));
  const lines: SubagentLine[] = [];
  const add = (parentId: string | null, depth: number) => {
    for (const row of rows) {
      const parent = row.parentId !== null && known.has(row.parentId) ? row.parentId : null;
      if (parent !== parentId || lines.some((line) => line.row.id === row.id)) continue;
      lines.push({ row, depth });
      add(row.id, depth + 1);
    }
  };
  add(null, 0);
  return lines;
}

export function subagentDurationMs(row: SubagentRow): number | null {
  if (row.startedAt === null || row.endedAt === null) return null;
  return Math.max(0, row.endedAt - row.startedAt);
}

export function shownSubagents(
  streamed: readonly SubagentRow[],
  persisted: readonly SubagentRow[] | undefined,
  leads: boolean,
): readonly SubagentRow[] {
  return leads || !persisted?.length ? streamed : persisted;
}
