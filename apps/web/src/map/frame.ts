import type { MapCategory } from '@spark-outpost/contracts';
import type { Bridge, LinkKind } from './bridges.ts';
import type { Camera, Viewport } from './camera.ts';
import type { FileKind } from './file-kind.ts';
import type { Network } from './network.ts';
import type { Palette } from './palette.ts';
import type { Scene } from './scene.ts';

export interface MapFilters {
  categories: ReadonlySet<MapCategory>;
  kinds: ReadonlySet<FileKind>;
  links: ReadonlySet<LinkKind>;
}

export interface MapView {
  scene: Scene;
  filters: MapFilters;
  changed: ReadonlySet<number>;
  dependents: ReadonlySet<number>;
  bridges: readonly Bridge[];
  path: readonly number[];
  pathBridge: string | null;
  selected: number | null;
  flagged: ReadonlySet<number>;
  flaggedHover: number | null;
  inset: number;
  building: { done: number; total: number } | null;
}

export type HoverTarget =
  | { type: 'file'; index: number }
  | { type: 'area'; index: number }
  | { type: 'bridge'; key: string };

export interface LabelRect {
  area: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BridgeGeometry {
  bridge: Bridge;
  points: [number, number][];
}

export interface Frame {
  ctx: CanvasRenderingContext2D;
  palette: Palette;
  camera: Camera;
  viewport: Viewport;
  view: MapView;
  time: number;
  reduced: boolean;
  transition: number;
  network: Network | null;
  zoom: number;
  hover: HoverTarget | null;
  focusArea: number;
  focusFile: number;
  pinned: { index: number; at: number } | null;
  reveal: (area: number) => number;
  pos: (file: number) => [number, number];
  radius: (file: number) => number;
  sx: (x: number) => number;
  sy: (y: number) => number;
  drawn: Uint8Array;
  labels: LabelRect[];
  bridgeGeometry: BridgeGeometry[];
}

export const CATEGORY_ALPHA: Record<MapCategory, number> = { core: 1, shared: 0.74, feature: 0.5 };
export const LABEL_ALPHA: Record<MapCategory, number> = { core: 1, shared: 0.86, feature: 0.72 };

export function fileVisible(frame: Frame, file: number): boolean {
  const { scene, filters } = frame.view;
  const f = scene.files[file]!;
  return (
    filters.kinds.has(f.kind) && filters.categories.has(scene.areas[f.areaIndex]!.area.category)
  );
}

export function line(frame: Frame, a: [number, number], b: [number, number]): void {
  const { ctx } = frame;
  ctx.beginPath();
  ctx.moveTo(frame.sx(a[0]), frame.sy(a[1]));
  ctx.lineTo(frame.sx(b[0]), frame.sy(b[1]));
  ctx.stroke();
}
