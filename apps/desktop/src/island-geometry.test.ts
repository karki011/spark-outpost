import { describe, expect, it } from 'vitest';
import { islandHoverReach } from '@spark-outpost/contracts';
import {
  clampToDisplay,
  displayNotch,
  dockedPosition,
  draggedPosition,
  islandBounds,
  islandDisplay,
  islandGeometry,
  isSize,
  liftedPosition,
  movedPosition,
  nearDock,
  notchRect,
  placement,
  placementLine,
  floatingBlob,
  restBlob,
  ISLAND_HEIGHT,
  ISLAND_WIDTH,
  type DisplayInfo,
} from './island-geometry.ts';

const BLOB = 30;
const SIZES = ['full', 'small', 'medium', 'large', 'xlarge'] as const;
const FLOATING_BLOB = floatingBlob(BLOB);

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
      windowTop: 0,
    });
    expect(islandGeometry(external, false)).toEqual({
      notch: false,
      top: 25,
      notchWidth: 0,
      notchHeight: 0,
      docked: false,
      menuBar: 25,
      windowTop: 0,
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
        windowTop: 0,
      });
    }
  });

  it('docks centred on the top edge of the primary display', () => {
    expect(placement({ docked: true }, [external, builtIn], 2, BLOB)).toEqual({
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
      expect(placement({ docked: true }, [intel], 1, BLOB)).toEqual({
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

  it('opens the flat resting window over the whole hover zone of every size', () => {
    const windows = SIZES.map((size) => {
      const { size: blob, tuck } = restBlob(size);
      const reach = islandHoverReach(blob);
      return islandBounds(
        { x: 360, y: 0 },
        { width: blob + 2 * reach, height: blob - tuck + reach },
      );
    });
    expect(windows).toEqual([
      { x: 832, y: 0, width: 96, height: 46 },
      { x: 847, y: 0, width: 66, height: 32 },
      { x: 840, y: 0, width: 80, height: 39 },
      { x: 832, y: 0, width: 96, height: 46 },
      { x: 790, y: 0, width: 180, height: 87 },
    ]);
  });

  it('restores a floating position on a display that still exists', () => {
    const saved = { docked: false as const, x: 2000, y: 100 };
    expect(placement(saved, [builtIn, external], 1, BLOB)).toMatchObject({
      display: external,
      position: { x: 2000, y: 100 },
      docked: false,
    });
    expect(placement(saved, [builtIn], 1, BLOB)).toMatchObject({ display: builtIn, docked: true });
  });

  it('restores the selected external dock after disconnection and reconnection', () => {
    const saved = { docked: false as const, ...dockedPosition(external) };
    const restored = { display: external, position: dockedPosition(external), docked: true };
    expect(placement(saved, [builtIn, external], 1, BLOB)).toEqual(restored);
    expect(placement(saved, [builtIn], 1, BLOB)).toEqual({
      display: builtIn,
      position: dockedPosition(builtIn),
      docked: true,
    });
    expect(placement(saved, [builtIn, external], 1, BLOB)).toEqual(restored);
  });

  it('finds a dock on a display narrower than the full island window', () => {
    const scaled = {
      ...external,
      bounds: { x: -800, y: 0, width: 800, height: 900 },
      workArea: { x: -800, y: 24, width: 800, height: 876 },
    };
    const saved = { docked: false as const, ...dockedPosition(scaled) };
    expect(saved.x).toBeLessThan(scaled.bounds.x);
    expect(placement(saved, [builtIn, scaled], 1, BLOB)).toEqual({
      display: scaled,
      position: dockedPosition(scaled),
      docked: true,
    });
  });

  it('keeps a dragged island on its display and docks when dropped near the top centre of a flat display', () => {
    const origin = dockedPosition(builtIn);
    const moved = draggedPosition(origin, { x: 700, y: 10 }, { x: 900, y: 310 }, builtIn, BLOB);
    expect(moved).toEqual({ x: origin.x + 200, y: 300 });
    expect(nearDock(moved, builtIn, BLOB)).toBe(false);
    expect(draggedPosition(origin, { x: 0, y: 0 }, { x: -5000, y: 5000 }, builtIn, BLOB)).toEqual({
      x: -160,
      y: 982 - ISLAND_HEIGHT,
    });
    expect(draggedPosition(origin, { x: 0, y: 0 }, { x: 5000, y: 0 }, builtIn, BLOB).x).toBe(
      1512 - ISLAND_WIDTH + 160,
    );
    const flat = { ...builtIn, notch: null };
    expect(nearDock({ x: origin.x + 24, y: 40 }, flat, BLOB)).toBe(true);
    expect(nearDock({ x: origin.x + 24, y: 90 }, flat, BLOB)).toBe(false);
    expect(nearDock({ x: origin.x + 120, y: 0 }, flat, BLOB)).toBe(false);
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

  it('lets a floating island reach the top of the screen beside the notch and on other displays', () => {
    expect(clampToDisplay({ x: 100, y: 0 }, builtIn, BLOB)).toEqual({ x: 100, y: 0 });
    expect(clampToDisplay({ x: 100, y: -40 }, builtIn, BLOB)).toEqual({ x: 100, y: 0 });
    expect(clampToDisplay({ x: 100, y: 200 }, builtIn, BLOB)).toEqual({ x: 100, y: 200 });
    expect(clampToDisplay({ x: 1600, y: -200 }, external, BLOB)).toEqual({ x: 1600, y: -200 });
    expect(clampToDisplay({ x: 1600, y: -900 }, external, BLOB)).toEqual({ x: 1600, y: -200 });
    expect(clampToDisplay({ x: 100, y: 0 }, { ...builtIn, notch: null }, BLOB)).toEqual({
      x: 100,
      y: 0,
    });
  });
});

describe('floating blob near the notch', () => {
  const notched: DisplayInfo = {
    id: 1,
    bounds: { x: 0, y: 0, width: 2056, height: 1329 },
    workArea: { x: 0, y: 44, width: 2056, height: 1285 },
    internal: true,
    notch: { width: 220, height: 38 },
  };
  const notchLeft = (2056 - 220) / 2;
  const centred = notchLeft + 110 - FLOATING_BLOB.x - FLOATING_BLOB.size / 2;
  const blobLeft = (x: number) => x + FLOATING_BLOB.x;

  it('keeps the blob exactly where it is dropped under the notch, at any height', () => {
    for (const y of [38, 39, 42, 60, 89, 140]) {
      const dropped = { x: centred, y };
      expect(nearDock(dropped, notched, BLOB)).toBe(false);
      expect(clampToDisplay(dropped, notched, BLOB)).toEqual(dropped);
      expect(placement({ docked: false, ...dropped }, [notched], 1, BLOB)).toEqual({
        display: notched,
        position: dropped,
        docked: false,
      });
    }
  });

  it('settles a blob pushed into the notch directly under it and docks one dropped there', () => {
    for (const y of [0, 10, 37]) {
      expect(clampToDisplay({ x: centred, y }, notched, BLOB)).toEqual({ x: centred, y: 38 });
      expect(nearDock({ x: centred, y }, notched, BLOB)).toBe(true);
    }
    expect(nearDock({ x: centred, y: -15 }, notched, BLOB)).toBe(true);
    const tall = { ...notched, notch: { width: 220, height: 37.5 } };
    expect(clampToDisplay({ x: centred, y: 5 }, tall, BLOB).y).toBe(38);
  });

  it('lets the blob sit in the menu bar strip right beside the notch', () => {
    const left = { x: notchLeft - FLOATING_BLOB.size - FLOATING_BLOB.x, y: 0 };
    const right = { x: notchLeft + 220 - FLOATING_BLOB.x, y: 4 };
    for (const beside of [left, right]) {
      expect(clampToDisplay(beside, notched, BLOB)).toEqual(beside);
      expect(nearDock(beside, notched, BLOB)).toBe(false);
    }
    expect(blobLeft(left.x) + FLOATING_BLOB.size).toBe(notchLeft);
    expect(clampToDisplay({ x: left.x + 1, y: 0 }, notched, BLOB)).toEqual({
      x: left.x + 1,
      y: 38,
    });
  });

  it('keeps the whole blob on the display and the open island on screen', () => {
    const far = clampToDisplay({ x: -9000, y: 9000 }, notched, BLOB);
    expect(blobLeft(far.x)).toBeGreaterThanOrEqual(0);
    expect(far.y + ISLAND_HEIGHT).toBe(1329);
    const other = clampToDisplay({ x: 9000, y: -9000 }, notched, BLOB);
    expect(blobLeft(other.x) + FLOATING_BLOB.size).toBeLessThanOrEqual(2056);
    expect(other.y).toBe(0);
  });

  it('centres a lifted blob on the pointer', () => {
    const lifted = liftedPosition({ x: 1028, y: 57 }, BLOB);
    expect(lifted).toEqual({ x: 1028 - FLOATING_BLOB.x - 15, y: 42 });
    expect(movedPosition(lifted, { x: 1028, y: 57 }, { x: 1030, y: 50 })).toEqual({
      x: lifted.x + 2,
      y: 35,
    });
  });

  it('scales the floating blob, its lift and its notch docking with the chosen size', () => {
    expect(SIZES.map((size) => restBlob(size))).toEqual([
      { size: 58, tuck: 31 },
      { size: 38, tuck: 20 },
      { size: 48, tuck: 25 },
      { size: 58, tuck: 31 },
      { size: 116, tuck: 61 },
    ]);
    for (const size of [38, 58, 116]) {
      const blob = floatingBlob(size);
      expect(blob.x + size / 2).toBe(ISLAND_WIDTH / 2);
      const lifted = liftedPosition({ x: 1028, y: 200 }, size);
      expect(lifted).toEqual({ x: 1028 - ISLAND_WIDTH / 2, y: 200 - size / 2 });
      const touching = { x: notchLeft - size - blob.x, y: 0 };
      expect(nearDock(touching, notched, size)).toBe(false);
      expect(nearDock({ ...touching, x: touching.x + 1 }, notched, size)).toBe(true);
      const under = { x: lifted.x, y: 20 };
      expect(clampToDisplay(under, notched, size)).toEqual({ x: lifted.x, y: 38 });
      expect(nearDock({ x: lifted.x, y: 38 }, notched, size)).toBe(false);
    }
  });

  it('still docks a saved dock position and restores one saved under the notch', () => {
    const dock = dockedPosition(notched);
    expect(placement({ docked: false, ...dock }, [notched], 1, BLOB)).toMatchObject({
      docked: true,
    });
    expect(
      placement({ docked: false, x: centred, y: 38 }, [notched, external], 1, BLOB),
    ).toMatchObject({
      docked: false,
      position: { x: centred, y: 38 },
    });
  });
});

describe('island window offset', () => {
  const notched: DisplayInfo = {
    id: 1,
    bounds: { x: 0, y: 0, width: 2056, height: 1329 },
    workArea: { x: 0, y: 44, width: 2056, height: 1285 },
    internal: true,
    notch: { width: 220, height: 38 },
  };

  it('reports how far the window top sits below the screen top', () => {
    expect(islandGeometry(notched, true).windowTop).toBe(0);
    expect(islandGeometry(notched, true, 44)).toMatchObject({ notchHeight: 38, windowTop: 44 });
    expect(islandGeometry(external, true, -200).windowTop).toBe(0);
    expect(islandGeometry(external, true, -175).windowTop).toBe(25);
    expect(islandGeometry(notched, true, -10).windowTop).toBe(0);
  });

  it('describes a placement with the display, the notch and both bounds', () => {
    const requested = { x: 508, y: 0, width: 1040, height: 600 };
    expect(
      placementLine(notched, true, requested, { ...requested, y: 44 }, restBlob('large')),
    ).toBe(
      'Island placed: display 2056x1329 at 0,0; work area 2056x1285 at 0,44; notch 220x38; docked, blob 58 tucked 31 at rest, requested 1040x600 at 508,0; actual 1040x600 at 508,44',
    );
    expect(
      placementLine(
        { ...notched, notch: undefined },
        true,
        requested,
        requested,
        restBlob('small'),
      ),
    ).toContain('notch 220x44 (from menu bar)');
    expect(
      placementLine({ ...notched, notch: null }, false, requested, requested, restBlob('xlarge')),
    ).toContain('notch none; floating, blob 116 not tucked, requested');
  });
});
