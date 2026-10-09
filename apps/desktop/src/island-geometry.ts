import { ISLAND_BLOB, islandTuck, type IslandSize } from '@spark-outpost/contracts';
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
  notch?: Size | null | undefined;
}

export interface Size {
  width: number;
  height: number;
}

export interface IslandGeometry {
  notch: boolean;
  top: number;
  notchWidth: number;
  notchHeight: number;
  docked: boolean;
  menuBar: number;
  windowTop: number;
}

export const ISLAND_WIDTH = 1040;
export const ISLAND_HEIGHT = 600;

export interface RestBlob {
  size: number;
  tuck: number;
}

export function restBlob(size: IslandSize): RestBlob {
  const blob = ISLAND_BLOB[size];
  return { size: blob, tuck: islandTuck(blob) };
}

export function floatingBlob(size: number): { x: number; y: number; size: number } {
  return { x: (ISLAND_WIDTH - size) / 2, y: 0, size };
}

const NOTCH_MENU_BAR_MIN = 30;
const NOTCH_ASPECT = 5;
const DEFAULT_TOP = 32;
const MIN_TOP = 24;
const MAX_TOP = 44;
const DOCK_REACH_X = 120;
const DOCK_REACH_Y = 90;
const REST_MIN_WIDTH = 40;
const REST_MIN_HEIGHT = 20;
const SIDE_SLACK = 160;

export function islandDisplay(
  displays: readonly DisplayInfo[],
  primaryId: number,
): DisplayInfo | null {
  return (
    displays.find((display) => display.id === primaryId) ??
    displays.find((display) => display.internal) ??
    displays[0] ??
    null
  );
}

export function displayNotch(display: DisplayInfo): Size | null {
  if (display.notch !== undefined) return display.notch;
  const menuBar = display.workArea.y - display.bounds.y;
  if (!display.internal || menuBar <= NOTCH_MENU_BAR_MIN) return null;
  return { width: Math.round(menuBar * NOTCH_ASPECT), height: menuBar };
}

export function notchRect(display: DisplayInfo): Rect | null {
  const notch = displayNotch(display);
  if (!notch) return null;
  const { bounds } = display;
  return {
    x: bounds.x + (bounds.width - notch.width) / 2,
    y: bounds.y,
    width: notch.width,
    height: notch.height,
  };
}

export function islandGeometry(
  display: DisplayInfo,
  docked: boolean,
  windowY: number = display.bounds.y,
): IslandGeometry {
  const menuBar = display.workArea.y - display.bounds.y;
  const notch = displayNotch(display);
  const notchHeight = notch ? Math.ceil(notch.height) : 0;
  const bar = menuBar > 0 ? Math.min(MAX_TOP, Math.max(MIN_TOP, menuBar)) : DEFAULT_TOP;
  return {
    notch: notch !== null,
    top: Math.max(bar, notchHeight),
    notchWidth: notch ? 2 * Math.ceil(notch.width / 2) : 0,
    notchHeight,
    docked,
    menuBar: Math.max(0, menuBar),
    windowTop: Math.max(0, Math.round(windowY - display.bounds.y)),
  };
}

function rectText(rect: Rect): string {
  return `${rect.width}x${rect.height} at ${rect.x},${rect.y}`;
}

function notchText(display: DisplayInfo): string {
  const notch = displayNotch(display);
  if (!notch) return 'none';
  const size = `${notch.width}x${notch.height}`;
  return display.notch === undefined ? `${size} (from menu bar)` : size;
}

function restText(docked: boolean, blob: RestBlob): string {
  return docked
    ? `docked, blob ${blob.size} tucked ${blob.tuck} at rest`
    : `floating, blob ${blob.size} not tucked`;
}

export function placementLine(
  display: DisplayInfo,
  docked: boolean,
  requested: Rect,
  actual: Rect,
  blob: RestBlob,
): string {
  return [
    `Island placed: display ${rectText(display.bounds)}`,
    `work area ${rectText(display.workArea)}`,
    `notch ${notchText(display)}`,
    `${restText(docked, blob)}, requested ${rectText(requested)}`,
    `actual ${rectText(actual)}`,
  ].join('; ');
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

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function blobRect(position: Point, size: number): Rect {
  const blob = floatingBlob(size);
  return { x: position.x + blob.x, y: position.y + blob.y, width: size, height: size };
}

export function clampToDisplay(position: Point, display: DisplayInfo, size: number): Point {
  const { bounds } = display;
  const fitted = {
    x: clamp(
      position.x,
      bounds.x - SIDE_SLACK,
      bounds.x + bounds.width - ISLAND_WIDTH + SIDE_SLACK,
    ),
    y: clamp(position.y, bounds.y, bounds.y + bounds.height - ISLAND_HEIGHT),
  };
  const notch = notchRect(display);
  if (!notch || !overlaps(blobRect(fitted, size), notch)) return fitted;
  return { x: fitted.x, y: Math.ceil(notch.y + notch.height) };
}

export function movedPosition(origin: Point, pointerStart: Point, pointer: Point): Point {
  return {
    x: Math.round(origin.x + pointer.x - pointerStart.x),
    y: Math.round(origin.y + pointer.y - pointerStart.y),
  };
}

export function liftedPosition(pointer: Point, size: number): Point {
  const blob = floatingBlob(size);
  return {
    x: Math.round(pointer.x - blob.x - size / 2),
    y: Math.round(pointer.y - blob.y - size / 2),
  };
}

export function draggedPosition(
  origin: Point,
  pointerStart: Point,
  pointer: Point,
  display: DisplayInfo,
  size: number,
): Point {
  return clampToDisplay(movedPosition(origin, pointerStart, pointer), display, size);
}

export function nearDock(position: Point, display: DisplayInfo, size: number): boolean {
  const notch = notchRect(display);
  if (notch) return overlaps(blobRect(position, size), notch);
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
  size: number,
): { display: DisplayInfo; position: Point; docked: boolean } | null {
  const home = islandDisplay(displays, primaryId);
  if (!home) return null;
  if (!saved.docked) {
    const anchor = { x: saved.x + ISLAND_WIDTH / 2, y: saved.y };
    const host = displays.find((display) => contains(display.bounds, anchor));
    if (host) {
      const docked = nearDock(saved, host, size);
      return {
        display: host,
        position: docked ? dockedPosition(host) : clampToDisplay(saved, host, size),
        docked,
      };
    }
  }
  return { display: home, position: dockedPosition(home), docked: true };
}
