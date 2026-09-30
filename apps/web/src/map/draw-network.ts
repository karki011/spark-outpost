import { shortName } from './file-kind.ts';
import { CATEGORY_ALPHA, fileVisible, type Frame } from './frame.ts';
import { placeLabels, type LabelRequest } from './labels.ts';

const LABEL_SHARE = 0.22;
const MAX_LABELS = 18;

function hoveredFile(frame: Frame): number {
  return frame.hover?.type === 'file' ? frame.hover.index : -1;
}

function neighbours(frame: Frame, file: number): Set<number> | null {
  if (file < 0) return null;
  const { scene } = frame.view;
  return new Set([...scene.outs[file]!, ...scene.ins[file]!]);
}

export function drawNetwork(frame: Frame): void {
  const network = frame.network;
  if (!network || frame.transition <= 0) return;
  const { ctx, palette, view } = frame;
  const t = frame.transition;
  const hovered = hoveredFile(frame);
  const near = neighbours(frame, hovered);
  const dim = view.changed.size > 0 ? 0.5 : 1;
  ctx.lineWidth = 1;
  for (const [a, b] of network.links) {
    const fa = network.files[a]!;
    const fb = network.files[b]!;
    const lit = hovered === fa || hovered === fb;
    const visible = fileVisible(frame, fa) && fileVisible(frame, fb);
    ctx.strokeStyle = palette.kind[view.scene.files[fa]!.kind];
    ctx.globalAlpha = t * (lit ? 0.9 : visible ? 0.2 : 0.04) * dim;
    ctx.lineWidth = lit ? 1.6 : 1;
    const [ax, ay] = frame.pos(fa);
    const [bx, by] = frame.pos(fb);
    ctx.beginPath();
    ctx.moveTo(frame.sx(ax), frame.sy(ay));
    ctx.lineTo(frame.sx(bx), frame.sy(by));
    ctx.stroke();
  }
  const category = view.scene.areas[network.areaIndex]!.area.category;
  for (const file of network.files) {
    frame.drawn[file] = 1;
    const f = view.scene.files[file]!;
    const visible = fileVisible(frame, file);
    const target = visible ? (near && !near.has(file) && file !== hovered ? 0.3 : 1) : 0.12;
    let alpha = CATEGORY_ALPHA[category] + (target - CATEGORY_ALPHA[category]) * t;
    if (view.changed.size > 0 && !view.changed.has(file))
      alpha *= view.dependents.has(file) ? 0.75 : 0.42;
    const [wx, wy] = frame.pos(file);
    const x = frame.sx(wx);
    const y = frame.sy(wy);
    const r = Math.max(0.7, frame.radius(file));
    const color = t > 0.5 ? palette.kind[f.kind] : palette.star;
    ctx.globalAlpha = alpha;
    const glow = t > 0.5 && palette.dark && r > 4.5;
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = r * 1.8;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (glow) ctx.shadowBlur = 0;
    if (t > 0.5 && (f.kind === 'test' || f.kind === 'config')) {
      ctx.strokeStyle = palette.sky1;
      ctx.globalAlpha = alpha * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  if (t > 0.55) drawNetworkLabels(frame, hovered, near);
}

function drawNetworkLabels(frame: Frame, hovered: number, near: Set<number> | null) {
  const network = frame.network!;
  const { ctx, palette, view } = frame;
  const files = network.files;
  const top = [...files]
    .sort((a, b) => view.scene.files[b]!.importance - view.scene.files[a]!.importance)
    .slice(0, Math.min(MAX_LABELS, Math.ceil(files.length * LABEL_SHARE)));
  const show = new Set(top);
  if (hovered >= 0 && network.slot.has(hovered)) {
    show.add(hovered);
    near?.forEach((file) => network.slot.has(file) && show.add(file));
  }
  if (frame.focusFile >= 0) show.add(frame.focusFile);
  ctx.font = '500 11.5px Geist, sans-serif';
  ctx.textAlign = 'center';
  const names = new Map<number, string>();
  const requests: LabelRequest[] = [];
  for (const file of show) {
    if (!fileVisible(frame, file) && file !== hovered) continue;
    const name = shortName(view.scene.files[file]!.path);
    names.set(file, name);
    const [x, y] = frame.pos(file);
    const lit = file === hovered || file === frame.focusFile;
    requests.push({
      id: file,
      width: ctx.measureText(name).width + 6,
      height: 15,
      x: frame.sx(x),
      y: frame.sy(y),
      r: frame.radius(file) + 2,
      priority: (lit ? 1e9 : 0) + view.scene.files[file]!.importance,
    });
  }
  const placements = placeLabels(requests, [], {
    width: frame.viewport.width - frame.viewport.inset,
    height: frame.viewport.height,
  });
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  const fade = (frame.transition - 0.55) / 0.45;
  for (const placement of placements) {
    if (placement.hidden) continue;
    const lit = placement.id === hovered || placement.id === frame.focusFile;
    ctx.globalAlpha = fade * (near && !show.has(placement.id) ? 0.3 : 1);
    ctx.strokeStyle = palette.sky1;
    const name = names.get(placement.id)!;
    ctx.strokeText(name, placement.x, placement.y + 4);
    ctx.fillStyle = lit ? palette.gold : palette.text;
    ctx.fillText(name, placement.x, placement.y + 4);
  }
  ctx.globalAlpha = 1;
}
