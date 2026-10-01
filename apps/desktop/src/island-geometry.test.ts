import { describe, expect, it } from 'vitest';
import {
  draggedPosition,
  islandDisplay,
  islandGeometry,
  nearDock,
  placement,
  ISLAND_WIDTH,
  type DisplayInfo,
} from './island-geometry.ts';

const builtIn: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 38, width: 1512, height: 944 },
  internal: true,
};

const external: DisplayInfo = {
  id: 2,
  bounds: { x: 1512, y: -200, width: 2560, height: 1440 },
  workArea: { x: 1512, y: -175, width: 2560, height: 1415 },
  internal: false,
};

describe('island placement', () => {
  it('prefers the built-in display, then the primary one', () => {
    expect(islandDisplay([external, builtIn], 2)).toBe(builtIn);
    expect(islandDisplay([external], 2)).toBe(external);
    expect(islandDisplay([], 2)).toBeNull();
  });

  it('detects a notch from a tall menu bar on the built-in display only', () => {
    expect(islandGeometry(builtIn, true)).toEqual({
      notch: true,
      top: 38,
      notchWidth: 190,
      docked: true,
    });
    expect(islandGeometry(external, false)).toEqual({
      notch: false,
      top: 25,
      notchWidth: 0,
      docked: false,
    });
    expect(islandGeometry({ ...builtIn, workArea: builtIn.bounds }, true).top).toBe(32);
  });

  it('treats a built-in display with a standard menu bar as having no notch', () => {
    for (const menuBar of [22, 24, 25]) {
      const intel = {
        ...builtIn,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: menuBar, width: 1440, height: 900 - menuBar },
      };
      expect(islandGeometry(intel, true)).toEqual({
        notch: false,
        top: Math.max(24, menuBar),
        notchWidth: 0,
        docked: true,
      });
    }
  });

  it('docks centred on the top edge of the built-in display', () => {
    expect(placement({ docked: true }, [external, builtIn], 2)).toEqual({
      display: builtIn,
      position: { x: (1512 - ISLAND_WIDTH) / 2, y: 0 },
      docked: true,
    });
  });

  it('restores a floating position on a display that still exists', () => {
    const saved = { docked: false as const, x: 2000, y: 100 };
    expect(placement(saved, [builtIn, external], 1)).toMatchObject({
      display: external,
      position: { x: 2000, y: 100 },
      docked: false,
    });
    expect(placement(saved, [builtIn], 1)).toMatchObject({ display: builtIn, docked: true });
  });

  it('keeps a dragged island on its display and docks when dropped near the notch', () => {
    const origin = { x: 396, y: 0 };
    const moved = draggedPosition(origin, { x: 700, y: 10 }, { x: 900, y: 310 }, builtIn);
    expect(moved).toEqual({ x: 596, y: 300 });
    expect(nearDock(moved, builtIn)).toBe(false);
    expect(draggedPosition(origin, { x: 0, y: 0 }, { x: -5000, y: 5000 }, builtIn)).toEqual({
      x: 0,
      y: 982 - 480,
    });
    expect(nearDock({ x: 420, y: 40 }, builtIn)).toBe(true);
  });
});
