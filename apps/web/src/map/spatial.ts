export class PointIndex {
  private readonly cells = new Map<string, number[]>();

  constructor(
    private readonly size: number,
    private readonly xs: ArrayLike<number>,
    private readonly ys: ArrayLike<number>,
    members: Iterable<number>,
  ) {
    for (const index of members) {
      const key = this.key(xs[index]!, ys[index]!);
      const cell = this.cells.get(key);
      if (cell) cell.push(index);
      else this.cells.set(key, [index]);
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }

  nearest(x: number, y: number, reach: (index: number) => number, maxReach: number): number {
    let best = -1;
    let bestDistance = Infinity;
    const x0 = Math.floor((x - maxReach) / this.size);
    const x1 = Math.floor((x + maxReach) / this.size);
    const y0 = Math.floor((y - maxReach) / this.size);
    const y1 = Math.floor((y + maxReach) / this.size);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        for (const index of this.cells.get(`${cx},${cy}`) ?? []) {
          const dx = this.xs[index]! - x;
          const dy = this.ys[index]! - y;
          const distance = dx * dx + dy * dy;
          const limit = reach(index);
          if (distance < limit * limit && distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
      }
    }
    return best;
  }
}
