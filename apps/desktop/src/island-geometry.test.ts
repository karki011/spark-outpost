import { describe, expect, it } from 'vitest';
import {
  clampToDisplay,
  displayNotch,
  dockedPosition,
  draggedPosition,
  islandBounds,
  islandDisplay,
  islandGeometry,
  isSize,
  nearDock,
  notchRect,
  placement,
  ISLAND_HEIGHT,
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
  it('prefers the primary display, with a built-in fallback', () => {
    expect(islandDisplay([external, builtIn], 2)).toBe(external);
    expect(islandDisplay([external, builtIn], 99)).toBe(builtIn);
    expect(islandDisplay([external], 2)).toBe(external);
    expect(islandDisplay([], 2)).toBeNull();
  });

  it('detects a notch from a tall menu bar on the built-in display only', () => {
    expect(islandGeometry(builtIn, true)).toEqual({
      notch: true,
      top: 38,
      notchWidth: 190,
      notchHeight: 38,
      docked: true,
      menuBar: 38,
    });
    expect(islandGeometry(external, false)).toEqual({
      notch: false,
      top: 25,
      notchWidth: 0,
      notchHeight: 0,
      docked: false,
      menuBar: 25,
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
        notchHeight: 0,
        docked: true,
        menuBar,
      });
    }
  });

  it('docks centred on the top edge of the primary display', () => {
    expect(placement({ docked: true }, [external, builtIn], 2)).toEqual({
      display: external,
      position: dockedPosition(external),
      docked: true,
    });
  });

  it('hangs from the very top of the screen over a standard menu bar', () => {
    for (const menuBar of [22, 24, 25]) {
      const intel: DisplayInfo = {
        ...builtIn,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: menuBar, width: 1440, height: 900 - menuBar },
      };
      expect(placement({ docked: true }, [intel], 1)).toEqual({
        display: intel,
        position: { x: (1440 - ISLAND_WIDTH) / 2, y: 0 },
        docked: true,
      });
      const monitor: DisplayInfo = {
        ...external,
        workArea: { ...external.workArea, y: external.bounds.y + menuBar },
      };
      expect(dockedPosition(monitor)).toEqual({ x: 1512 + (2560 - ISLAND_WIDTH) / 2, y: -200 });
    }
  });

  it('rests in a narrow strip centred where the full window would be', () => {
    const at = { x: 360, y: 0 };
    expect(islandBounds(at, null)).toEqual({
      x: 360,
      y: 0,
      width: ISLAND_WIDTH,
      height: ISLAND_HEIGHT,
    });
    expect(islandBounds(at, { width: 147, height: 37.2 })).toEqual({
      x: 360 + (ISLAND_WIDTH - 148) / 2,
      y: 0,
      width: 148,
      height: 38,
    });
    expect(islandBounds(at, { width: 1, height: 1 })).toMatchObject({ width: 40, height: 20 });
    expect(islandBounds(at, { width: 5000, height: 5000 })).toEqual({
      x: 360,
      y: 0,
      width: ISLAND_WIDTH,
      height: ISLAND_HEIGHT,
    });
    expect(isSize({ width: 100, height: 40 })).toBe(true);
    expect(isSize({ width: '100', height: 40 })).toBe(false);
    expect(isSize({ width: Number.NaN, height: 40 })).toBe(false);
    expect(isSize(null)).toBe(false);
  });

  it('sizes the resting window to the blobs it is told about, not to a row or the open island', () => {
    const blobs = { width: 176, height: 41.05 };
    const bounds = islandBounds({ x: 360, y: 0 }, blobs);
    expect(bounds).toEqual({ x: 360 + (ISLAND_WIDTH - 176) / 2, y: 0, width: 176, height: 42 });
    expect(bounds.width).toBeLessThan(ISLAND_WIDTH / 4);
    expect(bounds.height).toBeLessThan(ISLAND_HEIGHT / 10);
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

  it('restores the selected external dock after disconnection and reconnection', () => {
    const saved = { docked: false as const, ...dockedPosition(external) };
    const restored = { display: external, position: dockedPosition(external), docked: true };
    expect(placement(saved, [builtIn, external], 1)).toEqual(restored);
    expect(placement(saved, [builtIn], 1)).toEqual({
      display: builtIn,
      position: dockedPosition(builtIn),
      docked: true,
    });
    expect(placement(saved, [builtIn, external], 1)).toEqual(restored);
  });

  it('finds a dock on a display narrower than the full island window', () => {
    const scaled = {
      ...external,
      bounds: { x: -800, y: 0, width: 800, height: 900 },
      workArea: { x: -800, y: 24, width: 800, height: 876 },
    };
    const saved = { docked: false as const, ...dockedPosition(scaled) };
    expect(saved.x).toBeLessThan(scaled.bounds.x);
    expect(placement(saved, [builtIn, scaled], 1)).toEqual({
      display: scaled,
      position: dockedPosition(scaled),
      docked: true,
    });
  });

  it('keeps a dragged island on its display and docks when dropped near the notch', () => {
    const origin = dockedPosition(builtIn);
    const moved = draggedPosition(origin, { x: 700, y: 10 }, { x: 900, y: 310 }, builtIn);
    expect(moved).toEqual({ x: origin.x + 200, y: 300 });
    expect(nearDock(moved, builtIn)).toBe(false);
    expect(draggedPosition(origin, { x: 0, y: 0 }, { x: -5000, y: 5000 }, builtIn)).toEqual({
      x: -160,
      y: 982 - ISLAND_HEIGHT,
    });
    expect(draggedPosition(origin, { x: 0, y: 0 }, { x: 5000, y: 0 }, builtIn).x).toBe(
      1512 - ISLAND_WIDTH + 160,
    );
    expect(nearDock({ x: origin.x + 24, y: 40 }, builtIn)).toBe(true);
  });

  it('uses the measured notch over the menu bar guess', () => {
    const measured = { ...builtIn, notch: { width: 185, height: 32 } };
    expect(islandGeometry(measured, true)).toMatchObject({
      notch: true,
      top: 38,
      notchWidth: 186,
      notchHeight: 32,
    });
    expect(notchRect(measured)).toEqual({ x: 663.5, y: 0, width: 185, height: 32 });
    const none = { ...builtIn, notch: null };
    expect(islandGeometry(none, true)).toMatchObject({ notch: false, notchWidth: 0 });
    expect(notchRect(none)).toBeNull();
    expect(notchRect(external)).toBeNull();
  });

  it('finds a notch the menu bar guess would miss, and keeps the island below it', () => {
    const largerText = {
      ...builtIn,
      bounds: { x: 0, y: 0, width: 1024, height: 665 },
      workArea: { x: 0, y: 25, width: 1024, height: 640 },
    };
    expect(displayNotch(largerText)).toBeNull();
    const measured = { ...largerText, notch: { width: 126, height: 25 } };
    expect(islandGeometry(measured, true)).toMatchObject({ notch: true, top: 25, notchWidth: 126 });
    const tall = { ...builtIn, notch: { width: 222, height: 46.5 } };
    expect(islandGeometry(tall, true)).toMatchObject({ top: 47, notchHeight: 47, notchWidth: 222 });
  });

  it('scales the guessed notch with the menu bar when the display is scaled', () => {
    const moreSpace = {
      ...builtIn,
      bounds: { x: 0, y: 0, width: 1800, height: 1169 },
      workArea: { x: 0, y: 44, width: 1800, height: 1125 },
    };
    expect(displayNotch(moreSpace)).toEqual({ width: 220, height: 44 });
    expect(displayNotch(external)).toBeNull();
    expect(displayNotch({ ...external, notch: { width: 180, height: 30 } })).toEqual({
      width: 180,
      height: 30,
    });
  });

  it('keeps a floating island below the notch and leaves other displays alone', () => {
    expect(clampToDisplay({ x: 100, y: 0 }, builtIn)).toEqual({ x: 100, y: 38 });
    expect(clampToDisplay({ x: 100, y: 200 }, builtIn)).toEqual({ x: 100, y: 200 });
    expect(clampToDisplay({ x: 1600, y: -200 }, external)).toEqual({ x: 1600, y: -200 });
    expect(clampToDisplay({ x: 100, y: 0 }, { ...builtIn, notch: null })).toEqual({ x: 100, y: 0 });
  });
});
