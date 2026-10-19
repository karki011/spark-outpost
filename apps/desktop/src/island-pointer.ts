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

export function pollDelay(cursor: Point, bounds: Rect): number {
  const near =
    cursor.x >= bounds.x - NEAR_REACH &&
    cursor.x <= bounds.x + bounds.width + NEAR_REACH &&
    cursor.y >= bounds.y - NEAR_REACH &&
    cursor.y <= bounds.y + bounds.height + NEAR_REACH;
  return near ? NEAR_POLL_MS : FAR_POLL_MS;
}
