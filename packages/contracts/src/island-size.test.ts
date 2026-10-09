import { describe, expect, it } from 'vitest';
import { ISLAND_BLOB, ISLAND_SIZES, islandHoverReach, islandTuck } from './island-size.ts';

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

  it('reaches about a third of the blob past it for hover, never under 14 or over 32', () => {
    expect(ISLAND_SIZES.map((size) => islandHoverReach(ISLAND_BLOB[size]))).toEqual([
      19, 14, 16, 19, 32,
    ]);
    expect(islandHoverReach(1)).toBe(14);
    expect(islandHoverReach(400)).toBe(32);
  });
});
