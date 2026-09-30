import { clamp } from './camera.ts';
import type { Scene } from './scene.ts';

const FADE_MS = 650;
const DELAY_MS = 300;
const TOTAL_MS = 2400;
const MAX_STEP_MS = 520;

export class Reveal {
  private readonly start: number;
  private readonly step: number;
  private readonly order: number[];
  private readonly rank: Map<number, number>;
  private shown = -1;

  constructor(scene: Scene, now: number) {
    const areas = [...scene.areas].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    this.start = now + DELAY_MS;
    this.step = Math.min(MAX_STEP_MS, TOTAL_MS / Math.max(1, areas.length));
    this.order = areas.map((area) => area.index);
    this.rank = new Map(areas.map((area, rank) => [area.index, rank]));
  }

  alpha(area: number, now: number): number {
    const rank = this.rank.get(area) ?? 0;
    return clamp((now - this.start - rank * this.step) / FADE_MS, 0, 1);
  }

  progress(now: number): { shown: number; total: number; last: number } | null {
    const elapsed = now - this.start;
    const total = this.order.length;
    const shown = elapsed < 0 ? 0 : Math.min(total, Math.floor(elapsed / this.step) + 1);
    if (shown === this.shown) return null;
    this.shown = shown;
    return { shown, total, last: this.order[Math.max(0, shown - 1)] ?? -1 };
  }

  done(now: number): boolean {
    return now > this.start + this.order.length * this.step + FADE_MS;
  }
}
