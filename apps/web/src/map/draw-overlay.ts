import { baseName } from './file-kind.ts';
import type { Frame } from './frame.ts';

const PIN_MS = 1400;

function ring(
  frame: Frame,
  file: number | null | undefined,
  color: string,
  extra: number,
  dash?: number[],
) {
  if (file === null || file === undefined || file < 0) return;
  const { ctx } = frame;
  const [wx, wy] = frame.pos(file);
  const r = Math.max(2.5, frame.radius(file));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(frame.sx(wx), frame.sy(wy), r + 4 + extra, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawChanges(frame: Frame) {
  const { ctx, palette, view } = frame;
  const pulse = frame.reduced ? 0 : (frame.time * 0.9) % 1;
  for (const file of view.dependents) {
    if (view.changed.has(file)) continue;
    const [wx, wy] = frame.pos(file);
    ctx.strokeStyle = palette.warm;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(frame.sx(wx), frame.sy(wy), Math.max(2.6, frame.radius(file)) + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const file of view.changed) {
    const [wx, wy] = frame.pos(file);
    const x = frame.sx(wx);
    const y = frame.sy(wy);
    const r = Math.max(3.2, frame.radius(file) * 1.1);
    const size = r * 11;
    ctx.globalAlpha = palette.dark ? 0.8 : 0.55;
    ctx.drawImage(palette.warmGlow, x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.warm;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.warm;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = frame.reduced ? 0.7 : (1 - pulse) * 0.95;
    ctx.beginPath();
    ctx.arc(x, y, r + 3 + (frame.reduced ? 3 : pulse * 16), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPath(frame: Frame) {
  const { ctx, palette, view } = frame;
  const points = view.path.map((file) => {
    const [x, y] = frame.pos(file);
    return [frame.sx(x), frame.sy(y), file] as const;
  });
  if (points.length < 2) return;
  const trace = () => {
    ctx.beginPath();
    points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.gold;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 9;
  trace();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.2;
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = frame.reduced ? 0 : -frame.time * 28;
  trace();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  points.forEach(([x, y, file], index) => {
    ctx.fillStyle = palette.gold;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.sky1;
    ctx.font = '700 10.5px Geist, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(index + 1), x, y + 3.8);
    const crowded = points.some(
      ([ox, oy], other) => other !== index && Math.hypot(ox - x, oy - y) < 120,
    );
    const labelY = crowded && index % 2 === 0 ? y + 25 : y - 15;
    const name = baseName(view.scene.files[file]!.path);
    ctx.font = '500 11.5px Geist Mono, monospace';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = palette.sky1;
    ctx.strokeText(name, x, labelY);
    ctx.fillStyle = palette.text;
    ctx.fillText(name, x, labelY);
  });
}

export function drawOverlay(frame: Frame): void {
  const { ctx, palette, view } = frame;
  if (view.changed.size > 0) drawChanges(frame);
  if (frame.hover?.type === 'file') ring(frame, frame.hover.index, palette.gold, 0);
  ring(frame, view.selected, palette.gold, 2, [3, 3]);
  if (frame.pinned) {
    const left = frame.reduced
      ? 0
      : Math.max(0, 1 - (frame.time * 1000 - frame.pinned.at) / PIN_MS);
    ring(frame, frame.pinned.index, palette.gold, left * 26);
  }
  if (frame.transition > 0) ring(frame, frame.focusFile, palette.gold, 3);
  if (view.path.length === 0 && view.flagged.size > 0) {
    ctx.globalAlpha = 0.85;
    for (const file of view.flagged) ring(frame, file, palette.warm, 1, [2, 3]);
    ctx.globalAlpha = 1;
  }
  ring(frame, view.flaggedHover, palette.warm, 5);
  if (view.path.length > 0) drawPath(frame);
}

export function overlayAnimates(frame: Frame): boolean {
  if (frame.reduced) return false;
  const { view } = frame;
  if (view.changed.size > 0 || view.path.length > 0) return true;
  if (frame.pinned && frame.time * 1000 - frame.pinned.at < PIN_MS) return true;
  return view.bridges.length > 0;
}
