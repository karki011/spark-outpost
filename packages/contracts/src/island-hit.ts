export interface HitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScoutHit {
  box: HitBox;
  edge: number | null;
}

export interface IslandRegions {
  width: number;
  boxes: HitBox[];
  scout: ScoutHit | null;
}

export const NO_ISLAND_REGIONS: IslandRegions = { width: 0, boxes: [], scout: null };

const MAX_BOXES = 64;
const LIMIT = 100_000;
const BODY = { box: 64, cx: 32, cy: 39, rx: 22, up: 22, down: 19 } as const;

export function onScoutBody(box: HitBox, edge: number | null, x: number, y: number): boolean {
  if (box.width <= 0 || (edge !== null && y < edge)) return false;
  const scale = box.width / BODY.box;
  const dx = (x - box.x) / scale - BODY.cx;
  const dy = (y - box.y) / scale - BODY.cy;
  const ry = dy < 0 ? BODY.up : BODY.down;
  return (dx / BODY.rx) ** 2 + (dy / ry) ** 2 <= 1;
}

function inBox(box: HitBox, x: number, y: number): boolean {
  return (
    box.width > 0 &&
    box.height > 0 &&
    x >= box.x &&
    x <= box.x + box.width &&
    y >= box.y &&
    y <= box.y + box.height
  );
}

export function hitsIsland(regions: IslandRegions, x: number, y: number): boolean {
  if (regions.boxes.some((box) => inBox(box, x, y))) return true;
  const { scout } = regions;
  return scout !== null && onScoutBody(scout.box, scout.edge, x, y);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMIT;
}

function parseBox(value: unknown): HitBox | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
  if (width < 0 || height < 0) return null;
  return { x, y, width, height };
}

function parseScout(value: unknown): ScoutHit | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const { box, edge } = value as Record<string, unknown>;
  const parsed = parseBox(box);
  if (!parsed || (edge !== null && !finite(edge))) return undefined;
  return { box: parsed, edge };
}

export function parseIslandRegions(value: unknown): IslandRegions | null {
  if (!value || typeof value !== 'object') return null;
  const { width, boxes, scout } = value as Record<string, unknown>;
  if (!finite(width) || width < 0) return null;
  if (!Array.isArray(boxes) || boxes.length > MAX_BOXES) return null;
  const parsed = boxes.map(parseBox);
  if (parsed.some((box) => box === null)) return null;
  const body = parseScout(scout);
  if (body === undefined) return null;
  return { width, boxes: parsed as HitBox[], scout: body };
}
