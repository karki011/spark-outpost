import { clamp } from './camera.ts';
import { areaOnScreen } from './draw-sky.ts';
import { shortName } from './file-kind.ts';
import { LABEL_ALPHA, fileVisible, type Frame } from './frame.ts';
import { placeLabels, splitName, type LabelRequest, type Obstacle } from './labels.ts';
import { STAR_NAMES_PX } from './lod.ts';
import type { SceneArea } from './scene.ts';

const CATEGORY_RANK = { core: 3, shared: 2, feature: 1 } as const;
const MIN_LABEL_FILES = 3;

function fontSize(frame: Frame): number {
  return clamp(11 * Math.pow(frame.zoom, 0.25), 11, 15);
}

function labelCircle(frame: Frame, area: SceneArea): { x: number; y: number; r: number } {
  if (area.stars.length === 0) {
    return { x: frame.sx(area.x), y: frame.sy(area.y), r: area.r * frame.camera.k * 0.55 };
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const star of area.stars) {
    const [wx, wy] = frame.pos(star);
    x0 = Math.min(x0, wx);
    x1 = Math.max(x1, wx);
    y0 = Math.min(y0, wy);
    y1 = Math.max(y1, wy);
  }
  return {
    x: frame.sx((x0 + x1) / 2),
    y: frame.sy((y0 + y1) / 2),
    r: (Math.hypot(x1 - x0, y1 - y0) / 2) * frame.camera.k + 4,
  };
}

function obstacles(frame: Frame, areas: readonly SceneArea[]): Obstacle[] {
  const points: Obstacle[] = [];
  for (const area of areas) {
    for (const star of area.stars) {
      const [x, y] = frame.pos(star);
      points.push({ x: frame.sx(x), y: frame.sy(y), weight: 4 });
    }
    for (const [a, b] of area.tree) {
      const [ax, ay] = frame.pos(a);
      const [bx, by] = frame.pos(b);
      points.push({ x: frame.sx((ax + bx) / 2), y: frame.sy((ay + by) / 2), weight: 1.5 });
    }
  }
  return points;
}

function highlighted(frame: Frame, area: number): boolean {
  const hover = frame.hover;
  return (hover?.type === 'area' && hover.index === area) || frame.focusArea === area;
}

export function drawAreaLabels(frame: Frame): void {
  const { ctx, palette, view } = frame;
  const size = fontSize(frame);
  const lineHeight = size + 2;
  ctx.font = `600 ${size}px Geist, sans-serif`;
  ctx.letterSpacing = '1.6px';
  ctx.textAlign = 'center';
  const shown = view.scene.areas.filter(
    (area) => frame.reveal(area.index) > 0 && areaOnScreen(frame, area, 0),
  );
  const words = new Map<number, string[]>();
  const requests: LabelRequest[] = [];
  for (const area of shown) {
    if (area.area.fileCount < MIN_LABEL_FILES && !highlighted(frame, area.index)) continue;
    const lines = splitName(area.area.name.toUpperCase());
    words.set(area.index, lines);
    const width = Math.max(...lines.map((text) => ctx.measureText(text).width)) + 12;
    requests.push({
      id: area.index,
      width,
      height: lines.length * lineHeight + 6,
      ...labelCircle(frame, area),
      priority: CATEGORY_RANK[area.area.category] * 1e6 + area.area.fileCount,
    });
  }
  const visibleWidth = frame.viewport.width - frame.viewport.inset;
  const placements = placeLabels(requests, obstacles(frame, shown), {
    width: visibleWidth,
    height: frame.viewport.height,
  });
  const open = frame.network?.areaIndex ?? -1;
  for (const placement of placements) {
    const area = view.scene.areas[placement.id]!;
    const lit = highlighted(frame, area.index);
    if (placement.hidden && !lit) continue;
    const category = area.area.category;
    let alpha =
      frame.reveal(area.index) *
      LABEL_ALPHA[category] *
      (area.index === open ? 1 - frame.transition : 1 - frame.transition * 0.97) *
      (view.filters.categories.has(category) ? 1 : 0.25) *
      (view.path.length > 0 ? 0.5 : 1);
    if (lit) alpha = Math.max(alpha, 0.9 * (1 - frame.transition));
    if (alpha < 0.02) continue;
    const lines = words.get(area.index)!;
    const top = placement.y - placement.height / 2 + 3;
    ctx.fillStyle = palette.gold;
    ctx.globalAlpha = alpha;
    lines.forEach((text, row) =>
      ctx.fillText(text, placement.x, top + size * 0.95 + row * lineHeight),
    );
    const rect = {
      area: area.index,
      x: placement.x - placement.width / 2,
      y: placement.y - placement.height / 2,
      w: placement.width,
      h: placement.height,
    };
    if (lit) {
      ctx.strokeStyle = palette.gold;
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.roundRect(rect.x - 2, rect.y, rect.w + 4, rect.h, 6);
      ctx.stroke();
    }
    drawChangedCount(frame, area, placement.x, rect.y + rect.h + 11, alpha);
    frame.labels.push(rect);
  }
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;
}

function drawChangedCount(frame: Frame, area: SceneArea, x: number, y: number, alpha: number) {
  const { ctx, palette, view } = frame;
  if (view.changed.size === 0 || frame.transition > 0) return;
  const count = area.files.filter((file) => view.changed.has(file)).length;
  if (count === 0) return;
  ctx.letterSpacing = '0px';
  ctx.font = '600 11px Geist, sans-serif';
  ctx.fillStyle = palette.warm;
  ctx.globalAlpha = Math.max(alpha, 0.9);
  ctx.fillText(`${count} changed`, x, y);
  ctx.font = `600 ${fontSize(frame)}px Geist, sans-serif`;
  ctx.letterSpacing = '1.6px';
}

export function drawStarNames(frame: Frame): void {
  const { ctx, palette, view } = frame;
  if (frame.transition > 0 || view.building) return;
  ctx.font = '400 11px Geist Mono, monospace';
  ctx.textAlign = 'center';
  const requests: LabelRequest[] = [];
  const names = new Map<number, string>();
  for (const area of view.scene.areas) {
    if (area.r * frame.camera.k < STAR_NAMES_PX || !areaOnScreen(frame, area, 0)) continue;
    for (const star of area.stars) {
      if (!fileVisible(frame, star)) continue;
      const [x, y] = frame.pos(star);
      const name = shortName(view.scene.files[star]!.path);
      names.set(star, name);
      requests.push({
        id: star,
        width: ctx.measureText(name).width + 8,
        height: 14,
        x: frame.sx(x),
        y: frame.sy(y),
        r: frame.radius(star) + 3,
        priority: view.scene.files[star]!.importance,
      });
    }
  }
  if (requests.length === 0) return;
  const reserved = frame.labels.map((r): [number, number, number, number] => [
    r.x,
    r.y,
    r.x + r.w,
    r.y + r.h,
  ]);
  const placements = placeLabels(
    requests,
    [],
    { width: frame.viewport.width - frame.viewport.inset, height: frame.viewport.height },
    reserved,
  );
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  for (const placement of placements) {
    if (placement.hidden) continue;
    const name = names.get(placement.id)!;
    const dim = view.changed.size > 0 && !view.changed.has(placement.id) ? 0.45 : 1;
    ctx.globalAlpha = 0.85 * dim;
    ctx.strokeStyle = palette.sky1;
    ctx.strokeText(name, placement.x, placement.y + 4);
    ctx.fillStyle = palette.muted;
    ctx.fillText(name, placement.x, placement.y + 4);
  }
  ctx.globalAlpha = 1;
}
