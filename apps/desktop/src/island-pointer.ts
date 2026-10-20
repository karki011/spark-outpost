import { hitsIsland, type IslandRegions } from '@spark-outpost/contracts';
import type { Point, Rect } from './island-geometry.ts';

export const NEAR_POLL_MS = 16;
export const FAR_POLL_MS = 120;
const NEAR_REACH = 160;

export function windowPoint(cursor: Point, bounds: Rect): Point | null {
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return null;
  return { x, y };
}

export function pointerOnIsland(cursor: Point, bounds: Rect, regions: IslandRegions): boolean {
  const point = windowPoint(cursor, bounds);
  if (!point) return false;
  const shift = regions.width > 0 ? (bounds.width - regions.width) / 2 : 0;
  return hitsIsland(regions, point.x - shift, point.y);
}

function shown(regions: IslandRegions, bounds: Rect): Rect[] {
  const shift = regions.width > 0 ? (bounds.width - regions.width) / 2 : 0;
  const boxes = regions.scout ? [...regions.boxes, regions.scout.box] : regions.boxes;
  return boxes
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({ ...box, x: bounds.x + shift + box.x, y: bounds.y + box.y }));
}

function nearBox(cursor: Point, box: Rect): boolean {
  return (
    cursor.x >= box.x - NEAR_REACH &&
    cursor.x <= box.x + box.width + NEAR_REACH &&
    cursor.y >= box.y - NEAR_REACH &&
    cursor.y <= box.y + box.height + NEAR_REACH
  );
}

export function pollDelay(cursor: Point, bounds: Rect, regions: IslandRegions): number {
  const near = shown(regions, bounds).some((box) => nearBox(cursor, box));
  return near ? NEAR_POLL_MS : FAR_POLL_MS;
}
