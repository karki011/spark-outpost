import { clamp } from './camera.ts';
import { CATEGORY_ALPHA, fileVisible, line, type Frame } from './frame.ts';
import { drawBudget, placeholderStars } from './lod.ts';
import type { SceneArea } from './scene.ts';

interface Dust {
  u: number;
  v: number;
  s: number;
}

const DUST: Dust[] = (() => {
  let seed = 9;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 700 }, () => {
    const u = next();
    const v = next();
    const roll = next();
    return { u, v, s: roll < 0.1 ? 1.9 : roll < 0.4 ? 1.1 : 0.6 };
  });
})();

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

export function drawBackground(frame: Frame): void {
  const { ctx, palette, viewport, camera } = frame;
  const { width, height } = viewport;
  const gradient = ctx.createRadialGradient(
    width * 0.5,
    height * 0.42,
    0,
    width * 0.5,
    height * 0.5,
    Math.hypot(width, height) * 0.62,
  );
  gradient.addColorStop(0, palette.sky0);
  gradient.addColorStop(1, palette.sky1);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = palette.dust;
  ctx.globalAlpha = (palette.dark ? 0.8 : 0.6) * (1 - frame.transition * 0.5);
  const ox = -camera.x * camera.k * 0.06;
  const oy = -camera.y * camera.k * 0.06;
  for (const dust of DUST) {
    const x = (((dust.u * width + ox) % width) + width) % width;
    const y = (((dust.v * height + oy) % height) + height) % height;
    ctx.fillRect(x, y, dust.s, dust.s);
  }
  ctx.globalAlpha = 1;
  drawGrid(frame, 1 - frame.transition * 0.6);
}

function drawGrid(frame: Frame, alpha: number): void {
  const { ctx, palette, view } = frame;
  const combined = view.scene.projects.length > 1;
  for (const project of view.scene.projects) {
    const x = frame.sx(project.cx);
    const y = frame.sy(project.cy);
    const radius = project.radius * frame.camera.k;
    const color = combined ? palette.tints[project.tint % palette.tints.length]! : palette.grid;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * (combined ? 0.55 : 1);
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 5.5]);
    for (let ring = 1; ring <= 6; ring += 1) {
      ctx.beginPath();
      ctx.arc(x, y, (radius * ring) / 6.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let spoke = 0; spoke < 24; spoke += 1) {
      const angle = (spoke / 24) * Math.PI * 2;
      const inner = spoke % 2 ? (radius * 2) / 6.2 : radius / 6.2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      ctx.lineTo(
        x + (Math.cos(angle) * radius * 6) / 6.2,
        y + (Math.sin(angle) * radius * 6) / 6.2,
      );
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = alpha * 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (combined) drawProjectName(frame, project.name, x, y - radius, color, alpha);
  }
  ctx.globalAlpha = 1;
}

function drawProjectName(
  frame: Frame,
  name: string,
  x: number,
  top: number,
  color: string,
  alpha: number,
) {
  const { ctx } = frame;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = '600 14px Geist, sans-serif';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '3px';
  ctx.fillText(name.toUpperCase(), x, top - 12);
  ctx.letterSpacing = '0px';
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
    line(frame, anchorOf(frame, areaA), anchorOf(frame, areaB));
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

function drawField(frame: Frame, area: SceneArea, alpha: number, stars: ReadonlySet<number>) {
  const { ctx, palette } = frame;
  const screenR = area.r * frame.camera.k;
  const count = drawBudget(screenR, area.files.length);
  ctx.fillStyle = palette.star;
  for (let n = 0; n < count; n += 1) {
    const file = area.files[n]!;
    if (stars.has(file)) continue;
    frame.drawn[file] = 1;
    const a = starAlpha(frame, file, alpha);
    if (a < 0.02) continue;
    const f = frame.view.scene.files[file]!;
    const x = frame.sx(f.x);
    const y = frame.sy(f.y);
    const r = frame.radius(file);
    ctx.globalAlpha = a;
    if (r < 1.3) {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      continue;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlaceholder(frame: Frame, area: SceneArea, alpha: number) {
  const { ctx, palette } = frame;
  ctx.fillStyle = palette.star;
  const scale = Math.pow(frame.zoom, 0.38);
  const core = (1.7 + 5 * Math.sqrt(area.area.importance / frame.view.scene.maxImportance)) * scale;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(frame.sx(area.x), frame.sy(area.y), core, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.6;
  for (const [dx, dy] of placeholderFor(area)) {
    ctx.beginPath();
    ctx.arc(frame.sx(area.x + dx), frame.sy(area.y + dy), 0.9 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawStars(frame: Frame): void {
  const { view } = frame;
  const other = otherAlpha(frame);
  const open = frame.network?.areaIndex ?? -1;
  for (const area of view.scene.areas) {
    if (area.index === open && frame.transition > 0) continue;
    if (!areaOnScreen(frame, area)) continue;
    const alpha = frame.reveal(area.index) * CATEGORY_ALPHA[area.area.category] * other;
    if (alpha <= 0) continue;
    if (area.files.length === 0) {
      const shown = view.filters.categories.has(area.area.category) ? 1 : 0.1;
      drawPlaceholder(frame, area, alpha * shown * (view.changed.size > 0 ? 0.42 : 1));
      continue;
    }
    const stars = new Set(area.stars);
    drawField(frame, area, alpha, stars);
    const core = area.area.category === 'core';
    for (const star of area.stars) {
      frame.drawn[star] = 1;
      const a = starAlpha(frame, star, alpha);
      if (a >= 0.02) drawStar(frame, star, a, core);
    }
  }
  frame.ctx.globalAlpha = 1;
}
