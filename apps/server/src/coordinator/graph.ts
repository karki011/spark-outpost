export type Graph = ReadonlyMap<string, readonly string[]>;

export function reaches(graph: Graph, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [...(graph.get(from) ?? [])];
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (key === to) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...(graph.get(key) ?? []));
  }
  return false;
}

export function findCycle(keys: readonly string[], graph: Graph): string[] | null {
  const state = new Map<string, 'open' | 'done'>();
  const trail: string[] = [];
  const visit = (key: string): string[] | null => {
    if (state.get(key) === 'done') return null;
    if (state.get(key) === 'open') return [...trail.slice(trail.indexOf(key)), key];
    state.set(key, 'open');
    trail.push(key);
    for (const next of graph.get(key) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    trail.pop();
    state.set(key, 'done');
    return null;
  };
  for (const key of keys) {
    const cycle = visit(key);
    if (cycle) return cycle;
  }
  return null;
}

export function dependencyOrder<T extends { key: string; dependsOn: readonly string[] }>(
  pieces: readonly T[],
): T[] {
  const keys = new Set(pieces.map((piece) => piece.key));
  const waiting = new Map(
    pieces.map((piece) => [piece.key, piece.dependsOn.filter((dep) => keys.has(dep)).length]),
  );
  const order: T[] = [];
  const done = new Set<string>();
  while (order.length < pieces.length) {
    const ready = pieces
      .filter((piece) => !done.has(piece.key) && waiting.get(piece.key) === 0)
      .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
    const next = ready[0];
    if (!next) throw new Error('The piece list has a dependency cycle.');
    order.push(next);
    done.add(next.key);
    for (const piece of pieces) {
      if (piece.dependsOn.includes(next.key)) {
        waiting.set(piece.key, (waiting.get(piece.key) ?? 1) - 1);
      }
    }
  }
  return order;
}
