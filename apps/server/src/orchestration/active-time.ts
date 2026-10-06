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
