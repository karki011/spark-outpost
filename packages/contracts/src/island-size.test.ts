import { describe, expect, it } from 'vitest';
import {
  ISLAND_BLOB,
  ISLAND_SIZES,
  islandTuck,
  isIslandHeight,
  ISLAND_HEIGHT_RANGE,
} from './island-size.ts';

describe('island sizes', () => {
  it('ends with a size exactly twice the previous largest', () => {
    expect(ISLAND_SIZES.at(-1)).toBe('xlarge');
    expect(ISLAND_BLOB.xlarge).toBe(2 * ISLAND_BLOB.large);
    expect(Math.max(...Object.values(ISLAND_BLOB))).toBe(ISLAND_BLOB.xlarge);
  });

  it('hides a little over half of the blob at every size', () => {
    expect(ISLAND_SIZES.map((size) => islandTuck(ISLAND_BLOB[size]))).toEqual([31, 20, 25, 31, 61]);
    for (const size of ISLAND_SIZES) {
      const blob = ISLAND_BLOB[size];
      const shown = (blob - islandTuck(blob)) / blob;
      expect(shown).toBeGreaterThan(0.46);
      expect(shown).toBeLessThan(0.49);
    }
  });
});

it('accepts only whole island height offsets in the supported range', () => {
  expect(ISLAND_HEIGHT_RANGE).toEqual({ min: -32, max: 32, default: 0 });
  for (const value of [-32, -1, 0, 1, 32]) expect(isIslandHeight(value)).toBe(true);
  for (const value of [-33, 33, 1.5, NaN, Infinity, -Infinity, '0', null, undefined, {}, []]) {
    expect(isIslandHeight(value)).toBe(false);
  }
});
