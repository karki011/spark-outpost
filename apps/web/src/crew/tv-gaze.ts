import { project, pursuit, step, survey, threshold, HOLD_EPS, type Face } from 'blobatar/gaze';

export type GazeAim = 'rest' | null | { blob: string };

interface Point {
  x: number;
  y: number;
}

interface Place {
  center: Point;
  radius: number;
  width: number;
}

interface Watcher {
  svg: SVGSVGElement;
  place: Place | null;
  eyes: SVGElement | null;
  face: Face | null;
  aim: GazeAim;
  x: number;
  y: number;
  wx: number;
  wy: number;
  hold: number;
  wh: number;
}

interface Frame {
  watcher: Watcher;
  place: Place;
  target: Point | null;
  hold: number;
}

const TRAVEL = 3.2;
const MAX_DT = 64;
const PLACE_STALE_MS = 200;
const EYE_PROPS = ['dx', 'dy', 'sx', 'sy', 't'] as const;

function placeOf(element: Element): Place {
  const box = element.getBoundingClientRect();
  return {
    center: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    radius: Math.max(1, Math.min(box.width, box.height) / 2),
    width: Math.max(1, box.width),
  };
}

export class StageGaze {
  private watchers = new Map<string, Watcher>();
  private pointer: Point | null = null;
  private raf = 0;
  private last = 0;
  private placedAt = -Infinity;
  private paused = false;

  attach(id: string, svg: SVGSVGElement) {
    const existing = this.watchers.get(id);
    if (existing?.svg === svg) return;
    this.watchers.set(id, {
      svg,
      place: null,
      eyes: null,
      face: null,
      aim: existing?.aim ?? null,
      x: 0,
      y: 0,
      wx: Infinity,
      wy: Infinity,
      hold: 0,
      wh: -1,
    });
    this.wake();
  }

  detach(id: string) {
    this.watchers.delete(id);
  }

  aim(id: string, aim: GazeAim) {
    const watcher = this.watchers.get(id);
    if (!watcher || JSON.stringify(watcher.aim) === JSON.stringify(aim)) return;
    watcher.aim = aim;
    this.wake();
  }

  point(pointer: Point | null) {
    this.pointer = pointer;
    this.wake();
  }

  refresh() {
    for (const watcher of this.watchers.values()) {
      if (!watcher.eyes?.isConnected) watcher.eyes = null;
    }
    this.placedAt = -Infinity;
    this.wake();
  }

  pause(paused: boolean) {
    this.paused = paused;
    if (paused) this.cancel();
    else this.wake();
  }

  stop() {
    this.cancel();
  }

  private cancel() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.rest();
  }

  private rest() {
    this.last = 0;
    this.placedAt = -Infinity;
  }

  private wake() {
    if (this.paused || this.raf || typeof requestAnimationFrame !== 'function') return;
    this.raf = requestAnimationFrame((time) => this.frame(time));
  }

  private resolve(watcher: Watcher) {
    if (watcher.eyes?.isConnected && watcher.face) return;
    watcher.eyes = watcher.svg.querySelector<SVGElement>('.mo-eyes');
    watcher.face ??= survey(watcher.svg);
    watcher.wx = watcher.wy = Infinity;
  }

  private targetOf(watcher: Watcher): { point: Point | null; hold: number } {
    if (this.pointer) return { point: this.pointer, hold: 1 };
    if (watcher.aim === null) return { point: null, hold: 0 };
    if (watcher.aim === 'rest') return { point: null, hold: 1 };
    const other = this.watchers.get(watcher.aim.blob);
    return other?.place ? { point: other.place.center, hold: 1 } : { point: null, hold: 0 };
  }

  private place(time: number) {
    const stale = time - this.placedAt > PLACE_STALE_MS;
    if (stale) this.placedAt = time;
    for (const watcher of this.watchers.values()) {
      if (!watcher.svg.isConnected) continue;
      this.resolve(watcher);
      if (stale || !watcher.place) watcher.place = placeOf(watcher.svg);
    }
  }

  private measure(time: number): Frame[] {
    this.place(time);
    const frames: Frame[] = [];
    for (const watcher of this.watchers.values()) {
      if (!watcher.svg.isConnected || !watcher.eyes || !watcher.face || !watcher.place) continue;
      const { point, hold } = this.targetOf(watcher);
      frames.push({ watcher, place: watcher.place, target: point, hold });
    }
    return frames;
  }

  private write(frame: Frame, k: number): boolean {
    const { watcher, target } = frame;
    const { center, radius, width } = frame.place;
    const face = watcher.face!;
    const eyes = watcher.eyes!;
    const result = step({
      x: watcher.x,
      y: watcher.y,
      dx: target ? target.x - center.x : 0,
      dy: target ? target.y - center.y : 0,
      radius,
      k,
    });
    const eps = threshold(width, TRAVEL);
    let moving = false;
    if (Math.abs(result.tx - result.x) <= eps && Math.abs(result.ty - result.y) <= eps) {
      watcher.x = result.tx;
      watcher.y = result.ty;
    } else {
      watcher.x = result.x;
      watcher.y = result.y;
      moving = true;
    }
    watcher.hold += (frame.hold - watcher.hold) * k;
    if (Math.abs(frame.hold - watcher.hold) <= HOLD_EPS) watcher.hold = frame.hold;
    else moving = true;
    if (Math.abs(watcher.hold - watcher.wh) > HOLD_EPS) {
      watcher.wh = watcher.hold;
      watcher.svg.style.setProperty('--mo-track-hold', watcher.hold.toFixed(3));
    }
    if (Math.abs(watcher.x - watcher.wx) <= eps && Math.abs(watcher.y - watcher.wy) <= eps) {
      return moving;
    }
    watcher.wx = watcher.x;
    watcher.wy = watcher.y;
    eyes.style.setProperty('--mo-track-x', watcher.x.toFixed(3));
    eyes.style.setProperty('--mo-track-y', watcher.y.toFixed(3));
    face.marks.forEach((mark, index) => {
      const turn = project(mark, (watcher.x * TRAVEL) / face.rx, (watcher.y * TRAVEL) / face.ry);
      const values = [turn.dx * face.rx, turn.dy * face.ry, turn.sx, turn.sy, turn.t];
      EYE_PROPS.forEach((prop, slot) =>
        eyes.style.setProperty(`--mo-gz-${prop}${index + 1}`, values[slot]!.toFixed(3)),
      );
    });
    return true;
  }

  private frame(time: number) {
    this.raf = 0;
    const dt = this.last ? Math.min(time - this.last, MAX_DT) : 16;
    this.last = time;
    const k = pursuit(dt);
    const frames = this.measure(time);
    let moving = false;
    for (const frame of frames) moving = this.write(frame, k) || moving;
    if (moving) this.wake();
    else this.rest();
  }
}
