import { describe, expect, it } from 'vitest';
import { hitsIsland, parseIslandRegions, type IslandRegions } from './island-hit.ts';

const regions: IslandRegions = {
  width: 1040,
  boxes: [{ x: 600, y: 30, width: 60, height: 20 }],
  scout: { box: { x: 491, y: -31, width: 58, height: 58 }, edge: 0 },
};

describe('hitsIsland', () => {
  it('hits a box and its edge, not the space beside it', () => {
    expect(hitsIsland(regions, 630, 40)).toBe(true);
    expect(hitsIsland(regions, 600, 30)).toBe(true);
    expect(hitsIsland(regions, 662, 40)).toBe(false);
    expect(hitsIsland(regions, 630, 52)).toBe(false);
  });

  it("hits Scout's body below the edge but not the corners round it", () => {
    expect(hitsIsland(regions, 520, 10)).toBe(true);
    expect(hitsIsland(regions, 492, 25)).toBe(false);
    expect(hitsIsland(regions, 520, -2)).toBe(false);
  });

  it('ignores an empty box', () => {
    const empty = { ...regions, boxes: [{ x: 0, y: 0, width: 0, height: 20 }], scout: null };
    expect(hitsIsland(empty, 0, 10)).toBe(false);
  });
});

describe('parseIslandRegions', () => {
  it('accepts what the island page sends', () => {
    expect(parseIslandRegions(regions)).toEqual(regions);
    expect(parseIslandRegions({ width: 300, boxes: [], scout: null })).toEqual({
      width: 300,
      boxes: [],
      scout: null,
    });
  });

  it('refuses anything malformed or oversized', () => {
    expect(parseIslandRegions(null)).toBeNull();
    expect(parseIslandRegions({ ...regions, width: -1 })).toBeNull();
    expect(
      parseIslandRegions({ ...regions, boxes: [{ x: 'a', y: 0, width: 1, height: 1 }] }),
    ).toBeNull();
    expect(
      parseIslandRegions({ ...regions, boxes: [{ x: 0, y: 0, width: -1, height: 1 }] }),
    ).toBeNull();
    expect(parseIslandRegions({ ...regions, scout: { box: null, edge: 0 } })).toBeNull();
    expect(parseIslandRegions({ ...regions, boxes: Array(65).fill(regions.boxes[0]) })).toBeNull();
    expect(
      parseIslandRegions({ ...regions, boxes: [{ x: Infinity, y: 0, width: 1, height: 1 }] }),
    ).toBeNull();
  });
});
