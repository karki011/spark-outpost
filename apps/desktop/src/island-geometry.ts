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

export interface IslandGeometry {
  notch: boolean;
  top: number;
  notchWidth: number;
  docked: boolean;
}

export const ISLAND_WIDTH = 720;
export const ISLAND_HEIGHT = 480;

const NOTCH_MENU_BAR_MIN = 30;
const NOTCH_WIDTH = 190;
const DEFAULT_TOP = 32;
const MIN_TOP = 24;
const MAX_TOP = 44;
const DOCK_REACH_X = 120;
const DOCK_REACH_Y = 90;

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

function menuBarHeight(display: DisplayInfo): number {
  return display.workArea.y - display.bounds.y;
}

function hasNotch(display: DisplayInfo): boolean {
  return display.internal && menuBarHeight(display) > NOTCH_MENU_BAR_MIN;
}

export function islandGeometry(display: DisplayInfo, docked: boolean): IslandGeometry {
  const menuBar = menuBarHeight(display);
  const notch = hasNotch(display);
  const top = menuBar > 0 ? Math.min(MAX_TOP, Math.max(MIN_TOP, menuBar)) : DEFAULT_TOP;
  return { notch, top, notchWidth: notch ? NOTCH_WIDTH : 0, docked };
}

export function dockedPosition(display: DisplayInfo): Point {
  const { bounds, workArea } = display;
  return {
    x: bounds.x + Math.round((bounds.width - ISLAND_WIDTH) / 2),
    y: hasNotch(display) ? bounds.y : workArea.y,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
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
