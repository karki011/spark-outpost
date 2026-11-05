import type { SubagentRow } from '@spark-outpost/contracts';

export interface SubagentLine {
  row: SubagentRow;
  depth: number;
}

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

export function fileLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function hasDetail(row: SubagentRow): boolean {
  const task = row.task !== '' && row.task !== row.name;
  const did = row.steps.length + row.files.length + row.commands.length > 0;
  return task || did || Boolean(row.message ?? row.summary);
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
