function tenths(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

export class PageClock {
  private zeroWallMs: number | null = null;
  private wallMinusMonoMs: number | null = null;

  calibrate(monotonicSeconds: number, wallSeconds: number): void {
    this.wallMinusMonoMs ??= wallSeconds * 1000 - monotonicSeconds * 1000;
  }

  fromWall(wallMs: number): number {
    this.zeroWallMs ??= wallMs;
    return tenths(wallMs - this.zeroWallMs);
  }

  fromMonotonic(monotonicSeconds: number): number {
    const offset = this.wallMinusMonoMs ?? Date.now() - monotonicSeconds * 1000;
    this.wallMinusMonoMs = offset;
    return this.fromWall(monotonicSeconds * 1000 + offset);
  }

  reset(): void {
    this.zeroWallMs = null;
    this.wallMinusMonoMs = null;
  }
}
