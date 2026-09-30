import { panBy, toScreenX, toScreenY, toWorld, zoomAt, type Camera } from './camera.ts';
import type { MapEngine } from './engine.ts';
import type { HoverTarget } from './frame.ts';

const DRAG_PX = 4;
const PAN_PX = 60;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Press {
  x: number;
  y: number;
  camera: Camera;
  moved: boolean;
  node: number;
}

function segmentDistance(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / length));
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
}

export function hitTarget(engine: MapEngine, x: number, y: number): HoverTarget | null {
  const file = engine.hitFile(x, y);
  if (file >= 0) return { type: 'file', index: file };
  if (engine.network) return null;
  const label = engine.labels.find(
    (rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h,
  );
  if (label) return { type: 'area', index: label.area };
  for (const { bridge, points } of engine.bridgeGeometry) {
    for (let i = 1; i < points.length; i += 1) {
      if (segmentDistance(x, y, points[i - 1]!, points[i]!) < 7)
        return { type: 'bridge', key: bridge.key };
    }
  }
  return null;
}

function targetId(target: HoverTarget | null): string {
  if (!target) return '';
  return target.type === 'bridge' ? `bridge:${target.key}` : `${target.type}:${target.index}`;
}

function sameTarget(a: HoverTarget | null, b: HoverTarget | null): boolean {
  return targetId(a) === targetId(b);
}

function setHover(engine: MapEngine, target: HoverTarget | null, x: number, y: number) {
  engine.canvas.classList.toggle('pointer', target !== null);
  if (sameTarget(engine.hover, target)) {
    if (target) engine.callbacks.hover(target, x, y);
    return;
  }
  engine.hover = target;
  engine.callbacks.hover(target, x, y);
  engine.invalidate();
}

export function focusStep(engine: MapEngine, step: number): void {
  const scene = engine.view!.scene;
  if (engine.network) {
    const order = [...engine.network.files].sort(
      (a, b) => scene.files[b]!.importance - scene.files[a]!.importance,
    );
    const next = order[(order.indexOf(engine.focusFile) + step + order.length) % order.length]!;
    engine.focusFile = next;
    const [x, y] = engine.pos(next);
    const sx = toScreenX(engine.camera, engine.viewport, x);
    const sy = toScreenY(engine.camera, engine.viewport, y);
    setHover(engine, { type: 'file', index: next }, sx, sy);
    const file = scene.files[next]!;
    engine.callbacks.announce(`${file.path}. ${file.fanIn} files depend on this.`);
    return;
  }
  const angle = (index: number) => {
    const area = scene.areas[index]!;
    const project = scene.projects.find((p) => p.projectId === area.projectId)!;
    return (
      scene.projects.indexOf(project) * 10 + Math.atan2(area.y - project.cy, area.x - project.cx)
    );
  };
  const order = scene.areas.map((area) => area.index).sort((a, b) => angle(a) - angle(b));
  if (order.length === 0) return;
  engine.focusArea = order[(order.indexOf(engine.focusArea) + step + order.length) % order.length]!;
  const area = scene.areas[engine.focusArea]!;
  const where =
    scene.projects.length > 1
      ? ` in ${scene.projects.find((p) => p.projectId === area.projectId)?.name}`
      : '';
  engine.callbacks.announce(
    `${area.area.name}${where}. ${area.area.category} area, ${area.area.fileCount} files. Press Enter to open.`,
  );
  engine.invalidate();
}

function onKey(engine: MapEngine, event: KeyboardEvent) {
  const arrow = ARROWS[event.key];
  if (arrow && event.shiftKey) {
    event.preventDefault();
    engine.setCamera(panBy(engine.camera, -arrow[0] * PAN_PX, -arrow[1] * PAN_PX));
    return;
  }
  if (arrow) {
    event.preventDefault();
    focusStep(engine, arrow[0] + arrow[1] > 0 ? 1 : -1);
    return;
  }
  if (event.key === '+' || event.key === '=') engine.zoomBy(1.4);
  else if (event.key === '-') engine.zoomBy(1 / 1.4);
  else if (event.key === '0') engine.fitAll();
  else if (event.key === 'Escape') engine.callbacks.back();
  else if (event.key === 'Enter') {
    if (engine.network && engine.focusFile >= 0) engine.callbacks.openFile(engine.focusFile);
    else if (!engine.network && engine.focusArea >= 0) engine.callbacks.openArea(engine.focusArea);
  }
}

export function bindInput(engine: MapEngine): () => void {
  const canvas = engine.canvas;
  const pointers = new Map<number, { x: number; y: number }>();
  let press: Press | null = null;
  let pinch: { distance: number; camera: Camera; mid: { x: number; y: number } } | null = null;
  const local = (event: PointerEvent | WheelEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const startPinch = () => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    pinch = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      camera: { ...engine.camera },
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
    press = null;
  };
  const down = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    const point = local(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 2) return startPinch();
    const node = engine.network ? engine.hitFile(point.x, point.y) : -1;
    press = { ...point, camera: { ...engine.camera }, moved: false, node };
  };
  const move = (event: PointerEvent) => {
    const point = local(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const scale = Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAt(
        pinch.camera,
        engine.viewport,
        pinch.mid.x,
        pinch.mid.y,
        engine.clampZoom(pinch.camera.k * scale),
      );
      engine.setCamera(panBy(zoomed, mid.x - pinch.mid.x, mid.y - pinch.mid.y));
      return;
    }
    if (press) {
      if (Math.hypot(point.x - press.x, point.y - press.y) > DRAG_PX) press.moved = true;
      if (press.moved) {
        setHover(engine, null, 0, 0);
        if (press.node >= 0) {
          const world = toWorld(engine.camera, engine.viewport, point.x, point.y);
          engine.dragNode(press.node, world.x, world.y);
        } else {
          canvas.classList.add('drag');
          engine.setCamera(panBy(press.camera, point.x - press.x, point.y - press.y));
        }
        return;
      }
    }
    setHover(engine, hitTarget(engine, point.x, point.y), point.x, point.y);
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    canvas.classList.remove('drag');
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    const pressed = press;
    press = null;
    if (!pressed) return;
    if (pressed.node >= 0) engine.releaseNode(pressed.node);
    if (pressed.moved) return;
    const point = local(event);
    const target = hitTarget(engine, point.x, point.y);
    if (target?.type === 'file') engine.callbacks.openFile(target.index);
    else if (target?.type === 'area') engine.callbacks.openArea(target.index);
    else if (target?.type === 'bridge') engine.callbacks.pickBridge(target.key);
    else engine.callbacks.clickSky();
  };
  const leave = () => {
    if (!press) setHover(engine, null, 0, 0);
  };
  const doubleClick = (event: MouseEvent) => {
    if (engine.network || !engine.view) return;
    const point = local(event);
    const world = toWorld(engine.camera, engine.viewport, point.x, point.y);
    const near = engine.view.scene.areas
      .map((area) => ({ area, distance: Math.hypot(area.x - world.x, area.y - world.y) }))
      .filter(({ area, distance }) => distance < area.r * 1.2)
      .sort((a, b) => a.distance - b.distance)[0];
    if (near) engine.callbacks.openArea(near.area.index);
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const point = local(event);
    const k = engine.clampZoom(engine.camera.k * Math.exp(-event.deltaY * 0.0015));
    setHover(engine, null, 0, 0);
    engine.setCamera(zoomAt(engine.camera, engine.viewport, point.x, point.y, k));
  };
  const key = (event: KeyboardEvent) => onKey(engine, event);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('dblclick', doubleClick);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', key);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('dblclick', doubleClick);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('keydown', key);
  };
}
