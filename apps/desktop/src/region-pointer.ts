import { screen, type BrowserWindow } from 'electron';
import { NO_ISLAND_REGIONS, type IslandRegions } from '@spark-outpost/contracts';
import type { Point, Rect } from './island-geometry.ts';
import { pointerOnIsland, pollDelay } from './island-pointer.ts';

export interface RegionPointer {
  setRegions(regions: IslandRegions): void;
  hold(on: boolean): void;
  apply(): void;
  start(): void;
  stop(): void;
  interactive(): boolean;
}

interface RegionPointerOptions {
  afterApply?: (cursor: Point, bounds: Rect, interactive: boolean) => void;
}

export function regionPointer(
  window: BrowserWindow,
  options: RegionPointerOptions = {},
): RegionPointer {
  let regions: IslandRegions = NO_ISLAND_REGIONS;
  let held = false;
  let interactive = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const apply = () => {
    if (window.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const next = held || (window.isVisible() && pointerOnIsland(cursor, bounds, regions));
    if (next !== interactive) {
      interactive = next;
      window.setIgnoreMouseEvents(!interactive, { forward: true });
    }
    options.afterApply?.(cursor, bounds, interactive);
  };

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const tick = () => {
    timer = null;
    if (window.isDestroyed() || !window.isVisible()) return;
    apply();
    timer = setTimeout(
      tick,
      pollDelay(screen.getCursorScreenPoint(), window.getBounds(), regions),
    );
  };

  return {
    setRegions: (next) => {
      regions = next;
      apply();
      if (timer === null) tick();
    },
    hold: (on) => {
      held = on;
      apply();
      if (timer === null) tick();
    },
    apply,
    start: () => {
      if (timer === null) tick();
    },
    stop,
    interactive: () => interactive,
  };
}
