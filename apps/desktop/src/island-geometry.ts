import type { IslandPosition } from './companion-settings.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  internal: boolean;
}

export interface Size {
  width: number;
  height: number;
}

export interface IslandGeometry {
  notch: boolean;
  top: number;
  notchWidth: number;
  docked: boolean;
  menuBar: number;
}

export const ISLAND_WIDTH = 720;
export const ISLAND_HEIGHT = 600;

const NOTCH_MENU_BAR_MIN = 30;
const NOTCH_WIDTH = 190;
const DEFAULT_TOP = 32;
const MIN_TOP = 24;
const MAX_TOP = 44;
const DOCK_REACH_X = 120;
const DOCK_REACH_Y = 90;
const REST_MIN_WIDTH = 40;
const REST_MIN_HEIGHT = 20;

export function islandDisplay(
  displays: readonly DisplayInfo[],
  primaryId: number,
): DisplayInfo | null {
  return (
    displays.find((display) => display.internal) ??
    displays.find((display) => display.id === primaryId) ??
    displays[0] ??
    null
  );
}

export function islandGeometry(display: DisplayInfo, docked: boolean): IslandGeometry {
  const menuBar = display.workArea.y - display.bounds.y;
  const notch = display.internal && menuBar > NOTCH_MENU_BAR_MIN;
  const top = menuBar > 0 ? Math.min(MAX_TOP, Math.max(MIN_TOP, menuBar)) : DEFAULT_TOP;
  return { notch, top, notchWidth: notch ? NOTCH_WIDTH : 0, docked, menuBar: Math.max(0, menuBar) };
}

export function dockedPosition(display: DisplayInfo): Point {
  const { bounds } = display;
  return { x: bounds.x + Math.round((bounds.width - ISLAND_WIDTH) / 2), y: bounds.y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function isSize(value: unknown): value is Size {
  if (!value || typeof value !== 'object') return false;
  const { width, height } = value as Record<string, unknown>;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height)
  );
}

export function islandBounds(position: Point, rest: Size | null): Rect {
  if (!rest) return { ...position, width: ISLAND_WIDTH, height: ISLAND_HEIGHT };
  const width = 2 * Math.ceil(clamp(rest.width, REST_MIN_WIDTH, ISLAND_WIDTH) / 2);
  const height = Math.ceil(clamp(rest.height, REST_MIN_HEIGHT, ISLAND_HEIGHT));
  return { x: position.x + (ISLAND_WIDTH - width) / 2, y: position.y, width, height };
}

export function clampToDisplay(position: Point, display: DisplayInfo): Point {
  const { bounds } = display;
  return {
    x: clamp(position.x, bounds.x, bounds.x + bounds.width - ISLAND_WIDTH),
    y: clamp(position.y, bounds.y, bounds.y + bounds.height - ISLAND_HEIGHT),
  };
}

export function draggedPosition(
  origin: Point,
  pointerStart: Point,
  pointer: Point,
  display: DisplayInfo,
): Point {
  return clampToDisplay(
    {
      x: Math.round(origin.x + pointer.x - pointerStart.x),
      y: Math.round(origin.y + pointer.y - pointerStart.y),
    },
    display,
  );
}

export function nearDock(position: Point, display: DisplayInfo): boolean {
  const dock = dockedPosition(display);
  return (
    Math.abs(position.x - dock.x) < DOCK_REACH_X && position.y - display.bounds.y < DOCK_REACH_Y
  );
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

export function placement(
  saved: IslandPosition,
  displays: readonly DisplayInfo[],
  primaryId: number,
): { display: DisplayInfo; position: Point; docked: boolean } | null {
  const home = islandDisplay(displays, primaryId);
  if (!home) return null;
  if (!saved.docked) {
    const host = displays.find((display) => contains(display.bounds, saved));
    if (host) return { display: host, position: clampToDisplay(saved, host), docked: false };
  }
  return { display: home, position: dockedPosition(home), docked: true };
}
