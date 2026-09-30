export interface Constellation {
  stars: number[];
  tree: [number, number][];
}

const MAX_DEGREE = 3;

export function starCount(fileCount: number): number {
  return Math.max(Math.min(3, fileCount), Math.min(10, Math.round(Math.sqrt(fileCount) * 1.4)));
}

export function constellation(
  files: readonly number[],
  importance: (file: number) => number,
  neighbours: (file: number) => readonly number[],
): Constellation {
  if (files.length === 0) return { stars: [], tree: [] };
  const members = new Set(files);
  const brightest = files.reduce((best, file) =>
    importance(file) > importance(best) ? file : best,
  );
  const chosen = new Set([brightest]);
  const degree = new Map<number, number>([[brightest, 0]]);
  const tree: [number, number][] = [];
  const target = starCount(files.length);
  while (chosen.size < target) {
    let best: [number, number] | null = null;
    for (const star of chosen) {
      if ((degree.get(star) ?? 0) >= MAX_DEGREE) continue;
      for (const other of neighbours(star)) {
        if (!members.has(other) || chosen.has(other)) continue;
        if (!best || importance(other) > importance(best[1])) best = [star, other];
      }
    }
    if (!best) break;
    const [from, to] = best;
    chosen.add(to);
    tree.push(best);
    degree.set(from, (degree.get(from) ?? 0) + 1);
    degree.set(to, 1);
  }
  return { stars: [...chosen], tree };
}
