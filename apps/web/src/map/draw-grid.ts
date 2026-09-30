import { visibleArc } from './clip.ts';
import { dashedLine, type Frame } from './frame.ts';
import type { SceneProject } from './scene.ts';

interface Dust {
  u: number;
  v: number;
  s: number;
}

interface GridSprite {
  canvas: HTMLCanvasElement;
  color: string;
  dpr: number;
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

const SPRITE_RADIUS = 640;
const SPRITE_STRETCH = 1.4;
const sprites = new Map<string, GridSprite>();

type Stroke = (from: [number, number], to: [number, number]) => void;
type Ring = (x: number, y: number, r: number) => void;

function traceGrid(x: number, y: number, radius: number, ring: Ring, stroke: Stroke) {
  for (let step = 1; step <= 6; step += 1) ring(x, y, (radius * step) / 6.2);
  for (let spoke = 0; spoke < 24; spoke += 1) {
    const angle = (spoke / 24) * Math.PI * 2;
    const inner = spoke % 2 ? (radius * 2) / 6.2 : radius / 6.2;
    const outer = (radius * 6) / 6.2;
    stroke(
      [x + Math.cos(angle) * inner, y + Math.sin(angle) * inner],
      [x + Math.cos(angle) * outer, y + Math.sin(angle) * outer],
    );
  }
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  ring: Ring,
  stroke: Stroke,
) {
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.setLineDash([0.1, 5.5]);
  traceGrid(x, y, radius, ring, stroke);
  ctx.setLineDash([]);
  ctx.globalAlpha *= 0.5;
  ctx.lineWidth = 1;
  ring(x, y, radius);
}

function sprite(project: SceneProject, color: string, dpr: number): GridSprite {
  const cached = sprites.get(project.projectId);
  if (cached && cached.color === color && cached.dpr === dpr) return cached;
  const half = SPRITE_RADIUS + 4;
  const canvas = cached?.canvas ?? document.createElement('canvas');
  canvas.width = Math.ceil(half * 2 * dpr);
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, half * 2, half * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 1;
  const ring: Ring = (cx, cy, r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  const stroke: Stroke = (from, to) => {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  };
  paintGrid(ctx, half, half, SPRITE_RADIUS, ring, stroke);
  const next = { canvas, color, dpr };
  sprites.set(project.projectId, next);
  return next;
}

function drawProjectGrid(
  frame: Frame,
  project: SceneProject,
  color: string,
  alpha: number,
  dpr: number,
) {
  const { ctx } = frame;
  const x = frame.sx(project.cx);
  const y = frame.sy(project.cy);
  const radius = project.radius * frame.camera.k;
  ctx.globalAlpha = alpha;
  if (radius <= SPRITE_RADIUS * SPRITE_STRETCH) {
    const cached = sprite(project, color, dpr);
    const size = (cached.canvas.width / dpr) * (radius / SPRITE_RADIUS);
    ctx.drawImage(cached.canvas, x - size / 2, y - size / 2, size, size);
    return;
  }
  ctx.strokeStyle = color;
  const ring: Ring = (cx, cy, r) => {
    const span = visibleArc(cx, cy, r, frame.viewport.width, frame.viewport.height);
    if (!span) return;
    ctx.lineDashOffset = span[0] * r;
    ctx.beginPath();
    ctx.arc(cx, cy, r, span[0], span[1]);
    ctx.stroke();
    ctx.lineDashOffset = 0;
  };
  paintGrid(ctx, x, y, radius, ring, (from, to) => dashedLine(frame, from, to));
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
  const text = name.toUpperCase();
  const width = ctx.measureText(text).width;
  ctx.fillText(text, x, top - 12);
  ctx.letterSpacing = '0px';
  frame.reserved.push([x - width / 2 - 6, top - 30, x + width / 2 + 6, top - 4]);
}

export function drawBackground(frame: Frame, dpr: number): void {
  const { ctx, palette, viewport, camera, view } = frame;
  const { width, height } = viewport;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.dust;
  ctx.globalAlpha = (palette.dark ? 0.8 : 0.6) * (1 - frame.transition * 0.5);
  const ox = -camera.x * camera.k * 0.06;
  const oy = -camera.y * camera.k * 0.06;
  ctx.beginPath();
  for (const dust of DUST) {
    const x = (((dust.u * width + ox) % width) + width) % width;
    const y = (((dust.v * height + oy) % height) + height) % height;
    ctx.rect(x, y, dust.s, dust.s);
  }
  ctx.fill();
  const combined = view.scene.projects.length > 1;
  const alpha = (1 - frame.transition * 0.6) * (combined ? 0.55 : 1);
  for (const project of view.scene.projects) {
    const color = combined ? palette.tints[project.tint % palette.tints.length]! : palette.grid;
    drawProjectGrid(frame, project, color, alpha, dpr);
    const top = frame.sy(project.cy) - project.radius * camera.k;
    if (combined)
      drawProjectName(frame, project.name, frame.sx(project.cx), top, color, alpha / 0.55);
  }
  ctx.globalAlpha = 1;
}
