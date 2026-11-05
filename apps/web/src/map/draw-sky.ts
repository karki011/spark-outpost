import { clamp } from './camera.ts';
import { CATEGORY_ALPHA, dashedLine, fileVisible, line, type Frame } from './frame.ts';
import { StarBatch } from './star-batch.ts';
import { drawBudget, placeholderStars } from './lod.ts';
import type { SceneArea } from './scene.ts';

const SKELETON_CLUSTERS = 14;
const placeholders = new Map<string, [number, number][]>();

function placeholderFor(area: SceneArea): [number, number][] {
  const count = Math.min(24, Math.max(3, Math.round(Math.sqrt(area.area.fileCount) * 2)));
  const key = `${area.key}:${count}`;
  let points = placeholders.get(key);
  if (!points) {
    points = placeholderStars(area.key, count, area.r * 0.85);
    placeholders.set(key, points);
  }
  return points;
}

export function areaOnScreen(frame: Frame, area: SceneArea, margin = 40): boolean {
  const x = frame.sx(area.x);
  const y = frame.sy(area.y);
  const r = area.r * frame.camera.k + margin;
  return x > -r && y > -r && x < frame.viewport.width + r && y < frame.viewport.height + r;
}

export function drawSkeleton(frame: Frame): void {
  const building = frame.view.building;
  if (!building) return;
  const { ctx, palette } = frame;
  const lit = building.total > 0 ? (building.done / building.total) * SKELETON_CLUSTERS : 0;
  const reach = 420;
  for (let cluster = 0; cluster < SKELETON_CLUSTERS; cluster += 1) {
    const distance = reach * Math.sqrt((cluster + 0.5) / SKELETON_CLUSTERS);
    const angle = cluster * Math.PI * (3 - Math.sqrt(5));
    const cx = Math.cos(angle) * distance;
    const cy = Math.sin(angle) * distance;
    const on = cluster < lit;
    ctx.fillStyle = on ? palette.star : palette.skel;
    for (const [dx, dy] of placeholderStars(`skeleton-${cluster}`, 16, 58)) {
      const x = frame.sx(cx + dx);
      const y = frame.sy(cy + dy);
      const shimmer = frame.reduced
        ? 0.7
        : 0.45 + 0.55 * Math.max(0, Math.sin(frame.time * 2.2 - x * 0.01));
      ctx.globalAlpha = on ? 0.7 : shimmer;
      ctx.beginPath();
      ctx.arc(x, y, on ? 1.8 : 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = on ? 0.5 : 0.35;
    ctx.beginPath();
    ctx.roundRect(frame.sx(cx) - 30, frame.sy(cy - 70) - 3.5, 60, 7, 3.5);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function anchorOf(frame: Frame, area: SceneArea): [number, number] {
  const star = area.stars[0];
  return star === undefined ? [area.x, area.y] : frame.pos(star);
}

function otherAlpha(frame: Frame): number {
  return 1 - frame.transition * 0.93;
}

export function drawCrossLines(frame: Frame): void {
  const { ctx, palette, view } = frame;
  if (view.path.length > 0) return;
  const dim = view.changed.size > 0 ? 0.5 : 1;
  ctx.strokeStyle = palette.cross;
  ctx.setLineDash([2, 5]);
  for (const [a, b, weight] of view.scene.cross) {
    const alpha = frame.reveal(a) * frame.reveal(b);
    if (!alpha) continue;
    const areaA = view.scene.areas[a]!;
    const areaB = view.scene.areas[b]!;
    if (!areaOnScreen(frame, areaA, 4000) && !areaOnScreen(frame, areaB, 4000)) continue;
    ctx.globalAlpha = alpha * otherAlpha(frame) * dim * clamp(0.35 + weight / 60, 0.35, 1);
    ctx.lineWidth = clamp(0.6 + weight / 40, 0.6, 2.2);
    const [ax, ay] = anchorOf(frame, areaA);
    const [bx, by] = anchorOf(frame, areaB);
    dashedLine(frame, [frame.sx(ax), frame.sy(ay)], [frame.sx(bx), frame.sy(by)]);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function areaAlpha(frame: Frame, area: SceneArea): number {
  const category = area.area.category;
  const shown = frame.view.filters.categories.has(category) ? 1 : 0.12;
  return frame.reveal(area.index) * CATEGORY_ALPHA[category] * shown;
}

export function drawConstellations(frame: Frame): void {
  const { ctx, palette, view } = frame;
  ctx.lineCap = 'round';
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = palette.dark ? 1.1 : 1.2;
  const open = frame.network?.areaIndex ?? -1;
  for (const area of view.scene.areas) {
    if (area.tree.length === 0 || !areaOnScreen(frame, area)) continue;
    const fade = area.index === open ? 1 - frame.transition : otherAlpha(frame);
    ctx.globalAlpha =
      areaAlpha(frame, area) *
      fade *
      (view.changed.size > 0 ? 0.45 : 1) *
      (view.path.length > 0 ? 0.35 : 1);
    if (ctx.globalAlpha < 0.01) continue;
    for (const [a, b] of area.tree) line(frame, frame.pos(a), frame.pos(b));
  }
  ctx.globalAlpha = 1;
}

function starAlpha(frame: Frame, file: number, base: number): number {
  const { view } = frame;
  let alpha = base;
  if (!fileVisible(frame, file)) alpha *= 0.1;
  if (view.changed.size > 0 && !view.changed.has(file)) {
    alpha *= view.dependents.has(file) ? 0.75 : 0.42;
  }
  if (view.path.length > 0 && !view.path.includes(file)) alpha *= 0.3;
  return alpha;
}

function drawStar(frame: Frame, file: number, alpha: number, core: boolean) {
  const { ctx, palette } = frame;
  const [wx, wy] = frame.pos(file);
  const x = frame.sx(wx);
  const y = frame.sy(wy);
  const r = frame.radius(file);
  if (palette.dark && core && alpha > 0.3) {
    const size = r * 6.5;
    ctx.globalAlpha = alpha * 0.5;
    ctx.drawImage(palette.glow, x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = palette.sky1;
  ctx.beginPath();
  ctx.arc(x, y, r + (palette.dark ? 1.2 : 1.8), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = palette.star;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.7, r), 0, Math.PI * 2);
  ctx.fill();
}

function drawField(
  frame: Frame,
  area: SceneArea,
  alpha: number,
  stars: ReadonlySet<number>,
  batch: StarBatch,
) {
  const screenR = area.r * frame.camera.k;
  const count = drawBudget(screenR, area.files.length);
  const { width, height } = frame.viewport;
  for (let n = 0; n < count; n += 1) {
    const file = area.files[n]!;
    if (stars.has(file)) continue;
    const f = frame.view.scene.files[file]!;
    const x = frame.sx(f.x);
    const y = frame.sy(f.y);
    if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
    frame.drawn[file] = 1;
    batch.add(x, y, frame.radius(file), starAlpha(frame, file, alpha));
  }
}

function drawPlaceholder(frame: Frame, area: SceneArea, alpha: number, batch: StarBatch) {
  const scale = Math.pow(frame.zoom, 0.38);
  const core = (1.7 + 5 * Math.sqrt(area.area.importance / frame.view.scene.maxImportance)) * scale;
  batch.add(frame.sx(area.x), frame.sy(area.y), core, alpha);
  for (const [dx, dy] of placeholderFor(area)) {
    batch.add(frame.sx(area.x + dx), frame.sy(area.y + dy), 0.9 * scale, alpha * 0.6);
  }
}

export function drawStars(frame: Frame): void {
  const { view } = frame;
  const other = otherAlpha(frame);
  const open = frame.network?.areaIndex ?? -1;
  const batch = new StarBatch();
  const bright: [number, number, boolean][] = [];
  for (const area of view.scene.areas) {
    if (area.index === open && frame.transition > 0) continue;
    if (!areaOnScreen(frame, area)) continue;
    const alpha = frame.reveal(area.index) * CATEGORY_ALPHA[area.area.category] * other;
    if (alpha <= 0) continue;
    if (area.files.length === 0) {
      const shown = view.filters.categories.has(area.area.category) ? 1 : 0.1;
      drawPlaceholder(frame, area, alpha * shown * (view.changed.size > 0 ? 0.42 : 1), batch);
      continue;
    }
    const stars = new Set(area.stars);
    drawField(frame, area, alpha, stars, batch);
    const core = area.area.category === 'core';
    for (const star of area.stars) {
      frame.drawn[star] = 1;
      const a = starAlpha(frame, star, alpha);
      if (a >= 0.02) bright.push([star, a, core]);
    }
  }
  batch.fill(frame.ctx, frame.palette.star);
  for (const [star, a, core] of bright) drawStar(frame, star, a, core);
  frame.ctx.globalAlpha = 1;
}
