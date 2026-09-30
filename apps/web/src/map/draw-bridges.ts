import { bridgeCurve, curvePoint, endpoint, type Bridge, type LinkKind } from './bridges.ts';
import { clamp } from './camera.ts';
import type { Frame } from './frame.ts';
import type { Palette } from './palette.ts';

const SAMPLES = 24;
const LABELLED = 4;
const WEAK_LINK = 0.5;

function colorOf(palette: Palette, kind: LinkKind): string {
  if (kind === 'graphql') return palette.event;
  if (kind === 'package') return palette.types;
  if (kind === 'env') return palette.muted;
  return palette.bridge;
}

function dashOf(kind: LinkKind): number[] {
  if (kind === 'graphql') return [1, 5];
  if (kind === 'package') return [5, 5];
  if (kind === 'env') return [8, 4, 1, 4];
  return [];
}

function hoveredKey(frame: Frame): string | null {
  return frame.hover?.type === 'bridge' ? frame.hover.key : null;
}

function reach(frame: Frame): number {
  return frame.view.scene.projects.reduce((max, project) => Math.max(max, project.radius), 1);
}

function samples(frame: Frame, bridge: Bridge): [number, number][] | null {
  const { scene } = frame.view;
  const a = endpoint(scene, bridge.from, bridge.fromArea);
  const b = endpoint(scene, bridge.to, bridge.toArea);
  if (!a || !b) return null;
  const curve = bridgeCurve(a, b, bridge.hash, reach(frame));
  return Array.from({ length: SAMPLES + 1 }, (_, step) => {
    const [x, y] = curvePoint(curve, step / SAMPLES);
    return [frame.sx(x), frame.sy(y)];
  });
}

function labelText(bridge: Bridge): string {
  const first = bridge.links[0]!;
  const more = bridge.links.length > 1 ? `  +${bridge.links.length - 1}` : '';
  return `${first.label}${more}`;
}

export function drawBridges(frame: Frame): void {
  const { ctx, palette, view } = frame;
  const hovered = hoveredKey(frame);
  const tracing = view.pathBridge !== null;
  ctx.lineCap = 'round';
  for (const bridge of view.bridges) {
    if (!view.filters.links.has(bridge.kind)) continue;
    const points = samples(frame, bridge);
    if (!points) continue;
    frame.bridgeGeometry.push({ bridge, points });
    const on = hovered === bridge.key || view.pathBridge === bridge.key;
    ctx.strokeStyle = colorOf(palette, bridge.kind);
    ctx.lineWidth = on ? 2.4 : clamp(0.7 + bridge.links.length * 0.12, 0.7, 2);
    const weak = bridge.confidence < WEAK_LINK ? 0.45 : 1;
    ctx.globalAlpha =
      weak * (tracing && !on ? 0.08 : on ? 1 : 0.26 + Math.min(0.34, bridge.links.length * 0.03));
    ctx.setLineDash(dashOf(bridge.kind));
    ctx.beginPath();
    points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
  drawBridgeLabels(frame, hovered);
}

function drawBridgeLabels(frame: Frame, hovered: string | null) {
  const { ctx, palette, view } = frame;
  const shown = frame.bridgeGeometry
    .slice()
    .sort((a, b) => b.bridge.links.length - a.bridge.links.length)
    .slice(0, view.pathBridge ? 0 : LABELLED);
  for (const geometry of frame.bridgeGeometry) {
    const key = geometry.bridge.key;
    if ((key === hovered || key === view.pathBridge) && !shown.includes(geometry))
      shown.push(geometry);
  }
  ctx.font = '500 11px Geist Mono, monospace';
  ctx.textAlign = 'left';
  const taken: [number, number, number, number][] = frame.labels.map((r) => [
    r.x,
    r.y,
    r.x + r.w,
    r.y + r.h,
  ]);
  for (const { bridge, points } of shown) {
    const [x, y] = points[SAMPLES / 2]!;
    const text = labelText(bridge);
    const width = ctx.measureText(text).width + 14;
    const rect: [number, number, number, number] = [x - width / 2, y - 10, x + width / 2, y + 10];
    const on = bridge.key === hovered || bridge.key === view.pathBridge;
    const blocked = taken.some(
      (r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1],
    );
    if (blocked && !on) continue;
    taken.push(rect);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = palette.pill;
    ctx.beginPath();
    ctx.roundRect(rect[0], rect[1], width, 20, 10);
    ctx.fill();
    ctx.strokeStyle = colorOf(palette, bridge.kind);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.text;
    ctx.fillText(text, rect[0] + 7, y + 4);
  }
}

export function drawBridgeSparks(frame: Frame): void {
  if (frame.reduced) return;
  const { ctx, palette, view } = frame;
  const hovered = hoveredKey(frame);
  for (const { bridge, points } of frame.bridgeGeometry) {
    const on = bridge.key === hovered || bridge.key === view.pathBridge;
    if (view.pathBridge && !on) continue;
    if (!on && bridge.links.length < 4) continue;
    const phase = (frame.time * 0.35 + (bridge.hash % 100) / 100) % 1;
    const [x, y] = points[Math.floor(phase * SAMPLES)]!;
    ctx.globalAlpha = on ? 1 : 0.7;
    ctx.fillStyle = colorOf(palette, bridge.kind);
    ctx.beginPath();
    ctx.arc(x, y, on ? 2.6 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
