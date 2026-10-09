import { describe, expect, it } from 'vitest';
import type { IslandGeometry, IslandSize } from '../desktop/desktop-bridge.ts';
import {
  hoverZone,
  notchFit,
  restPose,
  restsQuietly,
  shownBox,
  stripHeight,
} from './island-fit.ts';
import { restMetrics } from './island-size.ts';

const notched: IslandGeometry = {
  notch: true,
  top: 44,
  notchWidth: 220,
  notchHeight: 38,
  docked: true,
  menuBar: 44,
};

describe('island fit under the notch', () => {
  it('keeps the whole notch when the window is at the top of the screen', () => {
    const expected = { hugsNotch: true, strip: 44, notchHeight: 38 };
    expect(notchFit(notched)).toEqual(expected);
    expect(notchFit({ ...notched, windowTop: 0 })).toEqual(expected);
    expect(notchFit({ ...notched, windowTop: -6 })).toEqual(expected);
    expect(stripHeight(notchFit(notched), true)).toBe(44);
    expect(stripHeight(notchFit(notched), false)).toBe(44);
  });

  it('counts only the part of the notch that reaches into a lowered window', () => {
    expect(notchFit({ ...notched, windowTop: 10 })).toEqual({
      hugsNotch: true,
      strip: 34,
      notchHeight: 28,
    });
    expect(notchFit({ ...notched, windowTop: 38 }).notchHeight).toBe(0);
    expect(notchFit({ ...notched, windowTop: 44 })).toEqual({
      hugsNotch: true,
      strip: 0,
      notchHeight: 0,
    });
    expect(notchFit({ ...notched, windowTop: 60 }).notchHeight).toBe(0);
  });

  it('falls back to the bar height when the notch height is not sent', () => {
    const old = { notch: true, top: 38, notchWidth: 190, docked: true, menuBar: 38 };
    expect(notchFit({ ...old, windowTop: 8 })).toEqual({
      hugsNotch: true,
      strip: 30,
      notchHeight: 30,
    });
  });

  it('ignores the notch and the window offset away from the dock or on a flat display', () => {
    expect(notchFit({ ...notched, docked: false, windowTop: 38 })).toEqual({
      hugsNotch: false,
      strip: 44,
      notchHeight: 0,
    });
    const flat = { ...notched, notch: false, top: 24, notchWidth: 0, notchHeight: 0 };
    expect(notchFit({ ...flat, windowTop: 24 })).toEqual({
      hugsNotch: false,
      strip: 24,
      notchHeight: 0,
    });
  });

  it('gives the resting blob no strip and an open view a usable one below the notch', () => {
    const below = notchFit({ ...notched, windowTop: 44 });
    expect(stripHeight(below, true)).toBe(0);
    expect(stripHeight(below, false)).toBe(24);
    expect(stripHeight(notchFit({ ...notched, windowTop: 60 }), true)).toBe(0);
  });
});

describe('the resting blob', () => {
  const pose = (size: IslandSize, edge: number, out = false, docked = true) =>
    restPose({ docked, edge, tuck: restMetrics(size).tuck, out });

  it('shows a little under half of itself below the top edge of a flat display', () => {
    expect(pose('small', 0)).toEqual({ y: -20, tucked: true, edge: null });
    expect(pose('medium', 0)).toEqual({ y: -25, tucked: true, edge: null });
    expect(pose('large', 0)).toEqual({ y: -31, tucked: true, edge: null });
    expect(pose('full', 0)).toEqual(pose('large', 0));
    expect(pose('xlarge', 0)).toEqual({ y: -61, tucked: true, edge: null });
  });

  it('shows the same part below the strip over a notch, clipped at the strip', () => {
    expect(pose('small', 44)).toEqual({ y: 24, tucked: true, edge: 44 });
    expect(pose('large', 38)).toEqual({ y: 7, tucked: true, edge: 38 });
    expect(pose('xlarge', 38)).toEqual({ y: -23, tucked: true, edge: 38 });
  });

  it('comes all the way out, 4 points below the edge', () => {
    expect(pose('large', 0, true)).toEqual({ y: 4, tucked: false, edge: null });
    expect(pose('xlarge', 38, true)).toEqual({ y: 42, tucked: false, edge: 38 });
  });

  it('is whole and unclipped when the island floats, out or not', () => {
    for (const out of [false, true]) {
      expect(pose('xlarge', 0, out, false)).toEqual({ y: 0, tucked: false, edge: null });
      expect(pose('small', 38, out, false).tucked).toBe(false);
    }
  });

  it('stays tucked only while Scout is idle or asleep', () => {
    expect(restsQuietly(null)).toBe(true);
    expect(restsQuietly('sleep')).toBe(true);
    for (const mood of ['working', 'alert', 'happy', 'sad'] as const) {
      expect(restsQuietly(mood)).toBe(false);
    }
  });

  it('takes pointer hits on the part that shows, not the part under the edge', () => {
    const tucked = { x: 462, y: -23, width: 116, height: 116 };
    expect(shownBox(tucked, 38)).toEqual({ x: 462, y: 38, width: 116, height: 55 });
    expect(shownBox({ ...tucked, y: -61 }, null)).toEqual({ x: 462, y: 0, width: 116, height: 55 });
    expect(shownBox({ ...tucked, y: 42 }, 38)).toEqual({ ...tucked, y: 42 });
    expect(shownBox({ ...tucked, y: -200 }, 38).height).toBe(0);
  });
});

describe('the resting hover zone', () => {
  const SIZES = ['full', 'small', 'medium', 'large', 'xlarge'] as const;
  const CENTRE = 640;
  const zoneAt = (size: IslandSize, edge: number, docked: boolean) => {
    const { blob, tuck, reach } = restMetrics(size);
    const pose = restPose({ docked, edge, tuck, out: false });
    const drawn = { x: CENTRE - blob / 2, y: docked ? pose.y : 200, width: blob, height: blob };
    return hoverZone(shownBox(drawn, pose.edge), reach, docked);
  };

  it('runs from the top edge of a flat display to a little past the half that shows', () => {
    expect(SIZES.map((size) => zoneAt(size, 0, true))).toEqual([
      { x: 592, y: 0, width: 96, height: 46 },
      { x: 607, y: 0, width: 66, height: 32 },
      { x: 600, y: 0, width: 80, height: 39 },
      { x: 592, y: 0, width: 96, height: 46 },
      { x: 550, y: 0, width: 180, height: 87 },
    ]);
  });

  it('covers the menu bar strip above the blob under a notch', () => {
    expect(SIZES.map((size) => zoneAt(size, 44, true))).toEqual([
      { x: 592, y: 0, width: 96, height: 90 },
      { x: 607, y: 0, width: 66, height: 76 },
      { x: 600, y: 0, width: 80, height: 83 },
      { x: 592, y: 0, width: 96, height: 90 },
      { x: 550, y: 0, width: 180, height: 131 },
    ]);
  });

  it('surrounds a floating blob on every side', () => {
    expect(SIZES.map((size) => zoneAt(size, 0, false))).toEqual([
      { x: 592, y: 181, width: 96, height: 96 },
      { x: 607, y: 186, width: 66, height: 66 },
      { x: 600, y: 184, width: 80, height: 80 },
      { x: 592, y: 181, width: 96, height: 96 },
      { x: 550, y: 168, width: 180, height: 180 },
    ]);
  });

  it('is never tighter than the half of the blob that shows', () => {
    for (const size of SIZES) {
      for (const edge of [0, 38, 44]) {
        const { blob, tuck } = restMetrics(size);
        const zone = zoneAt(size, edge, true);
        expect(zone.x).toBeLessThan(CENTRE - blob / 2);
        expect(zone.x + zone.width).toBeGreaterThan(CENTRE + blob / 2);
        expect(zone.y + zone.height).toBeGreaterThan(edge + blob - tuck);
      }
    }
  });
});
