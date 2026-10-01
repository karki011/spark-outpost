const SUBSTEP = 1 / 240;
const SETTLE_DISTANCE = 0.05;
const SETTLE_SPEED = 0.5;

export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const curve = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  return (x) => {
    let low = 0;
    let high = 1;
    let t = x;
    for (let step = 0; step < 14; step++) {
      if (curve(t, x1, x2) < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return curve(t, y1, y2);
  };
}

const closeCurve = bezier(0.45, 0, 0.2, 1);

export class Spring {
  value: number;
  target: number;
  private velocity = 0;
  private omega = 0;
  private damping = 0;
  private mode: 'idle' | 'spring' | 'curve' = 'idle';
  private from = 0;
  private startedAt = 0;
  private duration = 0;

  constructor(value: number) {
    this.value = value;
    this.target = value;
  }

  springTo(target: number, response = 0.5, damping = 0.72): void {
    this.omega = (2 * Math.PI) / response;
    this.damping = damping;
    this.target = target;
    this.mode = 'spring';
  }

  easeTo(target: number, now: number, ms = 340): void {
    this.from = this.value;
    this.target = target;
    this.velocity = 0;
    this.startedAt = now;
    this.duration = ms;
    this.mode = 'curve';
  }

  jump(target: number): void {
    this.value = target;
    this.target = target;
    this.velocity = 0;
    this.mode = 'idle';
  }

  get busy(): boolean {
    return this.mode !== 'idle';
  }

  step(dt: number, now: number): void {
    if (this.mode === 'spring') {
      const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
      const h = dt / steps;
      for (let index = 0; index < steps; index++) {
        const pull = this.omega * this.omega * (this.target - this.value);
        const drag = 2 * this.damping * this.omega * this.velocity;
        this.velocity += (pull - drag) * h;
        this.value += this.velocity * h;
      }
      const settled =
        Math.abs(this.target - this.value) < SETTLE_DISTANCE &&
        Math.abs(this.velocity) < SETTLE_SPEED;
      if (settled) this.jump(this.target);
      return;
    }
    if (this.mode === 'curve') {
      const progress = Math.min(1, (now - this.startedAt) / this.duration);
      if (progress >= 1) {
        this.jump(this.target);
        return;
      }
      this.value = this.from + (this.target - this.from) * closeCurve(progress);
    }
  }
}
