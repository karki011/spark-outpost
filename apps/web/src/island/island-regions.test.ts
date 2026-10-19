import { describe, expect, it } from 'vitest';
import { HIT_MARGIN, islandRegions, restGrows, restSize } from './island-regions.ts';

const line = { x: 600, y: 30, width: 60, height: 20 };
const scout = { box: { x: 491, y: -31, width: 58, height: 58 }, edge: 0 };

describe('islandRegions', () => {
  it('at rest takes exactly the lines, blobs and Scout, nothing round them', () => {
    const regions = islandRegions({ width: 1040, core: [], blobs: [line], scout, peek: true });
    expect(regions).toEqual({ width: 1040, boxes: [line], scout });
  });

  it('once open takes the island with a margin round it', () => {
    const core = { x: 300, y: 0, width: 440, height: 300 };
    const regions = islandRegions({
      width: 1040,
      core: [core],
      blobs: [],
      scout: null,
      peek: false,
    });
    expect(regions.boxes).toEqual([
      {
        x: 300 - HIT_MARGIN,
        y: -HIT_MARGIN,
        width: 440 + 2 * HIT_MARGIN,
        height: 300 + 2 * HIT_MARGIN,
      },
    ]);
  });

  it('leaves out anything not shown', () => {
    const hidden = { ...line, width: 0 };
    expect(
      islandRegions({ width: 1040, core: [], blobs: [hidden], scout: null, peek: true }).boxes,
    ).toEqual([]);
  });
});

describe('restSize', () => {
  it('fits every shown box with a margin, centred on the window', () => {
    expect(restSize([line], 1040)).toEqual({
      width: 2 * (660 + HIT_MARGIN - 520),
      height: 50 + HIT_MARGIN,
    });
    expect(restSize([], 1040)).toBeNull();
  });
});

describe('restGrows', () => {
  it('grows at once only when the strip is already resting and the new one is bigger', () => {
    const small = { width: 100, height: 40 };
    expect(restGrows({ width: 120, height: 40 }, small)).toBe(true);
    expect(restGrows({ width: 100, height: 60 }, small)).toBe(true);
    expect(restGrows({ width: 80, height: 40 }, small)).toBe(false);
    expect(restGrows(small, null)).toBe(false);
    expect(restGrows(small, undefined)).toBe(false);
    expect(restGrows(null, small)).toBe(false);
  });
});
