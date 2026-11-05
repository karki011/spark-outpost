import { describe, expect, it } from 'vitest';
import { onScoutBody } from '@spark-outpost/contracts';
import type { IslandGeometry, IslandSize } from '../desktop/desktop-bridge.ts';
import {
  notchFit,
  restLineTop,
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

  it('raises and lowers the working blob without moving the notch edge', () => {
    const base = { docked: true, edge: 38, tuck: 31, out: true, blob: 58 };
    expect(restPose({ ...base, height: -32 })).toEqual({ y: 10, tucked: true, edge: 38 });
    expect(restPose({ ...base, height: 32 })).toEqual({ y: 74, tucked: false, edge: 38 });
    expect(restPose({ ...base, height: 0 })).toEqual(pose('large', 38, true));
  });

  it('keeps a visible clickable portion at the highest position for every size', () => {
    for (const size of ['full', 'small', 'medium', 'large', 'xlarge'] as const) {
      const { blob, tuck } = restMetrics(size);
      for (const edge of [0, 38]) {
        for (const out of [false, true]) {
          const raised = restPose({ docked: true, edge, tuck, out, blob, height: -32 });
          const box = { x: 0, y: raised.y, width: blob, height: blob };
          expect(shownBox(box, raised.edge).height).toBeGreaterThanOrEqual(16);
          expect(raised.edge).toBe(edge || null);
        }
      }
      expect(restPose({ docked: false, edge: 38, tuck, out: true, blob, height: 32 })).toEqual({
        y: 0,
        tucked: false,
        edge: null,
      });
    }
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

describe('pointing at the resting blob', () => {
  const SIZES = ['full', 'small', 'medium', 'large', 'xlarge'] as const;
  const CENTRE = 640;
  const tucked = (size: IslandSize, edge: number) => {
    const { blob, tuck } = restMetrics(size);
    const pose = restPose({ docked: true, edge, tuck, out: false });
    return { box: { x: CENTRE - blob / 2, y: pose.y, width: blob, height: blob }, edge: pose.edge };
  };

  it('counts the half of the body that shows at every size', () => {
    for (const size of SIZES) {
      for (const edge of [0, 44]) {
        const { box, edge: clip } = tucked(size, edge);
        const bottom = box.y + (box.height * 58) / 64;
        expect(onScoutBody(box, clip, CENTRE, (edge + bottom) / 2)).toBe(true);
        expect(onScoutBody(box, clip, CENTRE, bottom - 1)).toBe(true);
      }
    }
  });

  it('ignores the transparent corners, the sides, below the body and above the edge', () => {
    for (const size of SIZES) {
      const { blob } = restMetrics(size);
      const { box, edge } = tucked(size, 44);
      const bottom = box.y + (box.height * 58) / 64;
      expect(onScoutBody(box, edge, box.x + 1, bottom - 1)).toBe(false);
      expect(onScoutBody(box, edge, box.x + box.width - 1, bottom - 1)).toBe(false);
      expect(onScoutBody(box, edge, CENTRE - blob / 2 - 4, 46)).toBe(false);
      expect(onScoutBody(box, edge, CENTRE + blob / 2 + 4, 46)).toBe(false);
      expect(onScoutBody(box, edge, CENTRE, bottom + 2)).toBe(false);
      expect(onScoutBody(box, edge, CENTRE, 43)).toBe(false);
    }
  });

  it('takes the whole body of a floating blob and nothing round it', () => {
    const box = { x: 600, y: 200, width: 80, height: 80 };
    expect(onScoutBody(box, null, 640, 240)).toBe(true);
    expect(onScoutBody(box, null, 640, 226)).toBe(true);
    expect(onScoutBody(box, null, 640, 218)).toBe(false);
    expect(onScoutBody(box, null, 610, 210)).toBe(false);
    expect(onScoutBody({ ...box, width: 0 }, null, 640, 240)).toBe(false);
  });
});
describe('the line beside the resting blob', () => {
  it('starts below the row of chat blobs and their badges', () => {
    expect(restLineTop(true, 0)).toBe(27);
    expect(restLineTop(false, 39)).toBe(63);
    expect(restLineTop(false, 7)).toBe(31);
  });
});
