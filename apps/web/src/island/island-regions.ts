import type { HitBox, IslandRegions, ScoutHit } from '@spark-outpost/contracts';

export const HIT_MARGIN = 14;

export interface RestSize {
  width: number;
  height: number;
}

interface RegionInput {
  width: number;
  core: readonly HitBox[];
  blobs: readonly HitBox[];
  scout: ScoutHit | null;
  peek: boolean;
}

function grown(box: HitBox, margin: number): HitBox {
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  };
}

export function islandRegions(input: RegionInput): IslandRegions {
  const margin = input.peek ? 0 : HIT_MARGIN;
  const boxes = [...input.core, ...input.blobs]
    .filter((box) => box.width > 0)
    .map((box) => grown(box, margin));
  return { width: input.width, boxes, scout: input.scout };
}

export function restSize(boxes: readonly HitBox[], width: number): RestSize | null {
  const shown = boxes.filter((box) => box.width > 0);
  if (shown.length === 0) return null;
  const taken = shown.map((box) => grown(box, HIT_MARGIN));
  const middle = width / 2;
  const reach = Math.max(
    ...taken.map((box) => Math.max(middle - box.x, box.x + box.width - middle)),
  );
  return { width: 2 * reach, height: Math.max(...taken.map((box) => box.y + box.height)) };
}

export function restGrows(next: RestSize | null, last: RestSize | null | undefined): boolean {
  if (!next || last === undefined) return false;
  if (last === null) return false;
  return next.width > last.width || next.height > last.height;
}
