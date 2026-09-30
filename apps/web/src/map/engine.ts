import {
  between,
  clamp,
  ease,
  fit,
  fitZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  toScreenX,
  toScreenY,
  type Camera,
  type Viewport,
} from './camera.ts';
import { drawBridgeLabels, drawBridges, drawBridgeSparks } from './draw-bridges.ts';
import { drawAreaLabels, drawStarNames } from './draw-labels.ts';
import { drawNetwork } from './draw-network.ts';
import { drawOverlay, overlayAnimates } from './draw-overlay.ts';
import { drawBackground } from './draw-grid.ts';
import {
  areaOnScreen,
  drawConstellations,
  drawCrossLines,
  drawSkeleton,
  drawStars,
} from './draw-sky.ts';
import type { BridgeGeometry, Frame, HoverTarget, LabelRect, MapView, Rect } from './frame.ts';
import type { LoadCandidate } from './lod.ts';
import { carryOver } from './carry-over.ts';
import { NetworkRunner, networkBounds, networkFor, remapNetwork, type Network } from './network.ts';
import { readPalette, type Palette } from './palette.ts';
import { Reveal } from './reveal.ts';
import type { Scene } from './scene.ts';
import { PointIndex } from './spatial.ts';

export interface EngineCallbacks {
  hover: (target: HoverTarget | null, x: number, y: number) => void;
  openFile: (file: number) => void;
  openArea: (area: number) => void;
  pickBridge: (key: string) => void;
  clickSky: () => void;
  back: () => void;
  announce: (text: string) => void;
  revealed: (shown: number, total: number, last: number) => void;
  wantFiles: (candidates: LoadCandidate[]) => void;
  reserved: () => Rect[];
}

const TRANSITION_MS = 900;
const FLY_MS = 900;
const LOD_EVERY_MS = 150;

interface Fly {
  from: Camera;
  to: Camera;
  start: number;
  duration: number;
}

export class MapEngine {
  readonly canvas: HTMLCanvasElement;
  readonly callbacks: EngineCallbacks;
  view: MapView | null = null;
  camera: Camera = { x: 0, y: 0, k: 1 };
  viewport: Viewport = { width: 0, height: 0, inset: 0 };
  network: Network | null = null;
  hover: HoverTarget | null = null;
  focusArea = -1;
  focusFile = -1;
  labels: LabelRect[] = [];
  bridgeGeometry: BridgeGeometry[] = [];
  drawn = new Uint8Array(0);
  reduced: boolean;
  private readonly context: CanvasRenderingContext2D;
  private readonly runner: NetworkRunner;
  private palette: Palette;
  private dpr = 1;
  private fitK = 1;
  private fly: Fly | null = null;
  private transition = 0;
  private direction = 0;
  private reveal: Reveal | null = null;
  pinned: { index: number; at: number } | null = null;
  private stars = new Uint8Array(0);
  private spatial: PointIndex | null = null;
  private dirty = true;
  private requested = 0;
  private lastTime = 0;
  private lastLod = 0;
  private lodTimer: ReturnType<typeof setTimeout> | undefined;
  private autoFit = true;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.context = canvas.getContext('2d')!;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.palette = readPalette(canvas.parentElement ?? document.body);
    this.runner = new NetworkRunner((update) => {
      if (!this.network) return;
      const first = this.network.positions === null;
      this.network.positions = update.positions;
      this.network.settled = update.done;
      if (first) this.beginEnter();
      this.invalidate();
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.requested);
    clearTimeout(this.lodTimer);
    this.runner.stop();
  }

  get zoom(): number {
    return this.camera.k / this.fitK;
  }

  refreshPalette(): void {
    this.palette = readPalette(this.canvas.parentElement ?? document.body);
    this.invalidate();
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.viewport = { ...this.viewport, width, height };
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    if (this.view) this.fitK = fitZoom(this.view.scene.bounds, this.viewport, this.pad());
    if (this.view && this.autoFit && !this.network) this.camera = this.fitCamera();
    this.invalidate();
  }

  setView(view: MapView): void {
    const previous = this.view;
    this.view = view;
    if (!previous || previous.scene !== view.scene) this.indexScene(previous?.scene ?? null);
    const insetChanged = previous !== null && previous.inset !== view.inset;
    const boundsChanged = previous?.scene.bounds.join() !== view.scene.bounds.join();
    this.viewport = { ...this.viewport, inset: view.inset };
    this.fitK = fitZoom(view.scene.bounds, this.viewport, this.pad());
    const fitted = this.autoFit || this.zoom < 1.25;
    if (this.viewport.width > 0 && !this.network && fitted && view.path.length === 0) {
      if (insetChanged) this.flyTo(this.fitCamera(), 600);
      else if (boundsChanged) this.camera = this.fitCamera();
    }
    this.invalidate();
  }

  private pad(): number {
    return this.viewport.width < 640 ? 44 : 24;
  }

  private indexScene(previous: Scene | null): void {
    const scene = this.view!.scene;
    if (previous) {
      const kept = carryOver(previous, scene, this);
      this.focusFile = kept.focusFile;
      this.focusArea = kept.focusArea;
      this.hover = kept.hover;
      this.pinned = kept.pinned;
      if (this.network) {
        const mapped = remapNetwork(this.network, previous, scene);
        if (mapped) this.network = mapped;
        else this.dropNetwork();
      }
    }
    this.drawn = new Uint8Array(scene.files.length);
    this.stars = new Uint8Array(scene.files.length);
    for (const area of scene.areas) for (const star of area.stars) this.stars[star] = 1;
    const xs = scene.files.map((file) => file.x);
    const ys = scene.files.map((file) => file.y);
    const cell = Math.max(8, (scene.bounds[2] - scene.bounds[0]) / 200);
    this.spatial = new PointIndex(cell, xs, ys, scene.files.keys());
  }

  fitCamera(): Camera {
    const box = this.network?.positions ? networkBounds(this.network!) : this.view!.scene.bounds;
    return fit(box, this.viewport, this.network ? 60 : this.pad());
  }

  flyTo(to: Camera, duration = FLY_MS): void {
    if (this.reduced || duration === 0) {
      this.camera = to;
      this.fly = null;
    } else {
      this.fly = { from: { ...this.camera }, to, start: performance.now(), duration };
    }
    this.invalidate();
  }

  zoomBy(factor: number): void {
    this.autoFit = false;
    this.flyTo({ ...this.camera, k: this.clampZoom(this.camera.k * factor) }, 350);
  }

  clampZoom(k: number): number {
    return clamp(k, this.fitK * MIN_ZOOM, this.fitK * MAX_ZOOM);
  }

  setCamera(camera: Camera): void {
    this.autoFit = false;
    this.fly = null;
    this.camera = { ...camera, k: this.clampZoom(camera.k) };
    this.invalidate();
  }

  flyToFile(file: number): void {
    this.autoFit = false;
    const f = this.view!.scene.files[file]!;
    const [x, y] = this.network?.slot.has(file) ? this.pos(file) : [f.x, f.y];
    const duration = this.reduced ? 0 : 1100;
    this.pinned = { index: file, at: performance.now() + duration };
    const k = this.network ? this.camera.k : Math.max(this.camera.k, this.fitK * 3.2);
    this.flyTo({ x: x + this.viewport.inset / 2 / k, y, k }, duration);
    this.callbacks.announce(`Found ${f.path}.`);
  }

  fitAll(): void {
    this.autoFit = !this.network;
    this.flyTo(this.fitCamera(), 800);
  }

  enterArea(area: number): void {
    const scene = this.view!.scene;
    const current = this.network;
    if (current?.areaIndex === area && current.files.length === scene.areas[area]!.files.length)
      return;
    this.hover = null;
    this.focusFile = -1;
    this.network = networkFor(scene, area);
    this.runner.start(scene, this.network, this.reduced);
  }

  private beginEnter(): void {
    if (this.direction === 1 || this.transition === 1) return;
    this.direction = this.reduced ? 0 : 1;
    if (this.reduced) this.transition = 1;
    this.flyTo(this.fitCamera(), 1000);
  }

  exitArea(): void {
    if (!this.network) return;
    this.hover = null;
    this.focusFile = -1;
    if (this.reduced) {
      this.dropNetwork();
    } else {
      this.direction = -1;
    }
    this.autoFit = true;
    this.flyTo(fit(this.view!.scene.bounds, this.viewport, this.pad()), 900);
  }

  private dropNetwork(): void {
    this.runner.stop();
    this.network = null;
    this.transition = 0;
    this.direction = 0;
    this.invalidate();
  }

  showBridge(key: string | null): void {
    const geometry = this.bridgeGeometry.find((entry) => entry.bridge.key === key);
    const [x, y] = geometry?.points[Math.floor(geometry.points.length / 2)] ?? [0, 0];
    this.hover = geometry ? { type: 'bridge', key: geometry.bridge.key } : null;
    this.callbacks.hover(this.hover, x, y);
    this.invalidate();
  }

  dragNode(file: number, x: number, y: number): void {
    const slot = this.network?.slot.get(file);
    if (slot !== undefined) this.runner.drag(slot, x, y);
  }

  releaseNode(file: number): void {
    const slot = this.network?.slot.get(file);
    if (slot !== undefined) this.runner.release(slot);
  }

  startReveal(): void {
    if (this.reduced || !this.view) return;
    this.reveal = new Reveal(this.view.scene, performance.now());
    this.invalidate();
  }

  private revealAlpha = (area: number): number =>
    this.reveal ? this.reveal.alpha(area, performance.now()) : 1;

  pos = (file: number): [number, number] => {
    const f = this.view!.scene.files[file]!;
    const network = this.network;
    const slot = network?.positions && this.transition > 0 ? network.slot.get(file) : undefined;
    if (slot === undefined) return [f.x, f.y];
    const t = ease(this.transition);
    const nx = network!.positions![slot * 2]!;
    const ny = network!.positions![slot * 2 + 1]!;
    return [f.x + (nx - f.x) * t, f.y + (ny - f.y) * t];
  };

  private skyRadius(file: number): number {
    const scene = this.view!.scene;
    const s = Math.sqrt(Math.max(0, scene.files[file]!.importance) / scene.maxImportance);
    const z = clamp(Math.pow(this.zoom, 0.38), 0.55, 3.4);
    return this.stars[file] ? (1.7 + 6.6 * s) * z : (0.8 + 2.4 * s) * z;
  }

  radius = (file: number): number => {
    const slot = this.network && this.transition > 0 ? this.network.slot.get(file) : undefined;
    if (slot === undefined) return this.skyRadius(file);
    const net = Math.max(2.5, this.network!.radius[slot]! * this.camera.k);
    return this.skyRadius(file) + (net - this.skyRadius(file)) * ease(this.transition);
  };

  hitFile(sx: number, sy: number): number {
    const scene = this.view?.scene;
    if (!scene) return -1;
    const world = {
      x: (sx - this.viewport.width / 2) / this.camera.k + this.camera.x,
      y: (sy - this.viewport.height / 2) / this.camera.k + this.camera.y,
    };
    const reach = (file: number) => Math.max(7, this.radius(file) + 4) / this.camera.k;
    if (this.network && this.transition >= 1) {
      let best = -1;
      let bestDistance = Infinity;
      for (const file of this.network.files) {
        const [x, y] = this.pos(file);
        const distance = Math.hypot(x - world.x, y - world.y);
        if (distance < reach(file) && distance < bestDistance) {
          best = file;
          bestDistance = distance;
        }
      }
      return best;
    }
    if (this.transition > 0 || !this.spatial) return -1;
    const maxReach = Math.max(7, 7 * 3.4 + 4) / this.camera.k;
    return this.spatial.nearest(
      world.x,
      world.y,
      (file) => (this.drawn[file] ? reach(file) : 0),
      maxReach,
    );
  }

  invalidate(): void {
    this.dirty = true;
    this.request();
  }

  private request(): void {
    if (!this.requested) this.requested = requestAnimationFrame(this.loop);
  }

  private frame(ctx: CanvasRenderingContext2D, now: number): Frame {
    return {
      ctx,
      palette: this.palette,
      camera: this.camera,
      viewport: this.viewport,
      view: this.view!,
      time: now / 1000,
      reduced: this.reduced,
      transition: ease(this.transition),
      network: this.network?.positions ? this.network : null,
      zoom: this.zoom,
      hover: this.hover,
      focusArea: this.focusArea,
      focusFile: this.focusFile,
      pinned: this.pinned ? { index: this.pinned.index, at: this.pinned.at / 1000 } : null,
      reveal: this.revealAlpha,
      pos: this.pos,
      radius: this.radius,
      sx: (x) => toScreenX(this.camera, this.viewport, x),
      sy: (y) => toScreenY(this.camera, this.viewport, y),
      drawn: this.drawn,
      labels: [],
      bridgeGeometry: [],
      reserved: [],
    };
  }

  private step(now: number): boolean {
    const dt = Math.min(64, now - (this.lastTime || now));
    this.lastTime = now;
    let moving = false;
    if (this.fly) {
      const t = (now - this.fly.start) / this.fly.duration;
      this.camera = between(this.fly.from, this.fly.to, t);
      if (t >= 1) this.fly = null;
      moving = true;
    }
    if (this.direction !== 0) {
      this.transition = clamp(this.transition + (this.direction * dt) / TRANSITION_MS, 0, 1);
      if (this.transition === 0 && this.direction < 0) this.dropNetwork();
      else if (this.transition === 1) this.direction = 0;
      moving = true;
    }
    if (this.network && !this.network.settled) moving = true;
    if (this.reveal) {
      const progress = this.reveal.progress(now);
      if (progress) this.callbacks.revealed(progress.shown, progress.total, progress.last);
      if (this.reveal.done(now)) this.reveal = null;
      moving = true;
    }
    if (this.view?.building && !this.reduced) moving = true;
    return moving;
  }

  private drawBase(frame: Frame): void {
    const ctx = frame.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawn.fill(0);
    frame.reserved.push(...this.callbacks.reserved());
    drawBackground(frame, this.dpr);
    drawSkeleton(frame);
    drawCrossLines(frame);
    if (frame.view.bridges.length > 0) drawBridges(frame);
    drawConstellations(frame);
    drawStars(frame);
    drawNetwork(frame);
    drawAreaLabels(frame);
    if (frame.view.bridges.length > 0) drawBridgeLabels(frame);
    drawStarNames(frame);
    this.labels = frame.labels;
    this.bridgeGeometry = frame.bridgeGeometry;
  }

  private loop = (now: number): void => {
    this.requested = 0;
    if (!this.view || this.viewport.width === 0) return;
    const moving = this.step(now);
    const frame = this.frame(this.context, now);
    this.drawBase(frame);
    if (this.dirty || moving) this.maybeLoad(now);
    this.dirty = false;
    drawBridgeSparks(frame);
    drawOverlay(frame);
    if (moving || overlayAnimates(frame)) this.request();
  };

  private maybeLoad(now: number): void {
    if (this.lodTimer) return;
    const wait = Math.max(0, LOD_EVERY_MS - (now - this.lastLod));
    this.lodTimer = setTimeout(() => {
      this.lodTimer = undefined;
      this.lastLod = performance.now();
      this.emitLoad();
    }, wait);
  }

  private emitLoad(): void {
    if (!this.view) return;
    const frame = this.frame(this.context, performance.now());
    this.callbacks.wantFiles(
      this.view.scene.areas.map((area) => ({
        key: area.key,
        screenRadius: area.r * this.camera.k,
        fileCount: area.area.fileCount,
        loaded: area.files.length,
        visible: areaOnScreen(frame, area),
      })),
    );
  }
}
