const LEVELS = 20;
const TAU = Math.PI * 2;
const SQUARE_BELOW = 1.3;

export class StarBatch {
  private readonly paths = new Map<number, Path2D>();

  add(x: number, y: number, r: number, alpha: number): void {
    const level = Math.round(Math.min(1, alpha) * LEVELS);
    if (level === 0) return;
    let path = this.paths.get(level);
    if (!path) {
      path = new Path2D();
      this.paths.set(level, path);
    }
    if (r < SQUARE_BELOW) {
      path.rect(x - r, y - r, r * 2, r * 2);
      return;
    }
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, TAU);
  }

  fill(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.fillStyle = color;
    for (const [level, path] of this.paths) {
      ctx.globalAlpha = level / LEVELS;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
  }
}
