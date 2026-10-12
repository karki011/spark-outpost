import type { ScoutMood } from '../brand/BlobScout.tsx';
import type { IslandGeometry } from '../desktop/desktop-bridge.ts';

const MIN_STRIP = 24;
const OUT_GAP = 4;
const FLAT_ROW_BOTTOM = 18;
const ROW_BLOB_DROP = 15;
const ROW_BADGE = 5;
const LINE_GAP = 4;

interface NotchFit {
  hugsNotch: boolean;
  strip: number;
  notchHeight: number;
}

export function notchFit(geometry: IslandGeometry): NotchFit {
  const hugsNotch = geometry.notch && geometry.docked;
  if (!hugsNotch) return { hugsNotch, strip: geometry.top, notchHeight: 0 };
  const lowered = Math.max(0, geometry.windowTop ?? 0);
  return {
    hugsNotch,
    strip: geometry.top - lowered,
    notchHeight: Math.max(0, (geometry.notchHeight ?? geometry.top) - lowered),
  };
}

export function stripHeight(fit: NotchFit, quiet: boolean): number {
  return Math.max(fit.strip, quiet ? 0 : MIN_STRIP);
}

export function restsQuietly(mood: ScoutMood): boolean {
  return mood === null || mood === 'sleep';
}

interface RestPose {
  y: number;
  tucked: boolean;
  edge: number | null;
}

interface RestInput {
  docked: boolean;
  edge: number;
  tuck: number;
  out: boolean;
}

export function restPose({ docked, edge, tuck, out }: RestInput): RestPose {
  if (!docked) return { y: 0, tucked: false, edge: null };
  const clip = edge > 0 ? edge : null;
  if (out) return { y: edge + OUT_GAP, tucked: false, edge: clip };
  return { y: edge - tuck, tucked: true, edge: clip };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function shownBox(box: Box, edge: number | null): Box {
  const top = Math.max(box.y, edge ?? 0, 0);
  return { x: box.x, y: top, width: box.width, height: Math.max(0, box.y + box.height - top) };
}

export function hoverZone(shown: Box, reach: number, docked: boolean): Box {
  const top = docked ? 0 : shown.y - reach;
  return {
    x: shown.x - reach,
    y: top,
    width: shown.width + 2 * reach,
    height: shown.y + shown.height + reach - top,
  };
}

export function restLineTop(flat: boolean, rowTop: number): number {
  const rowBottom = flat ? FLAT_ROW_BOTTOM : rowTop + ROW_BLOB_DROP;
  return rowBottom + ROW_BADGE + LINE_GAP;
}
