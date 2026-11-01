export interface TabEdge {
  id: string;
  start: number;
  end: number;
}

export function dropBefore(edges: readonly TabEdge[], pointer: number): string | null {
  return edges.find((edge) => pointer < (edge.start + edge.end) / 2)?.id ?? null;
}

export function changesOrder(ids: readonly string[], id: string, before: string | null): boolean {
  const index = ids.indexOf(id);
  if (index < 0 || before === id) return false;
  return (ids[index + 1] ?? null) !== before;
}

export function keyedBefore(
  ids: readonly string[],
  id: string,
  delta: -1 | 1,
): string | null | undefined {
  const index = ids.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return undefined;
  return delta < 0 ? ids[target]! : (ids[target + 1] ?? null);
}

export function movedLine(label: string, position: number, count: number): string {
  return `Moved ${label} to position ${position} of ${count}`;
}
