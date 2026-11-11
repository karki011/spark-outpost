import { describe, expect, it } from 'vitest';
import { farthestCorner, INK_SOLID, inkLobes, inkReach } from './ink-mask.ts';

describe('ink mask', () => {
  it('gives the same lobes for the same seed and others for another', () => {
    expect(inkLobes(7)).toEqual(inkLobes(7));
    expect(inkLobes(7)).not.toEqual(inkLobes(8));
  });

  it('measures to the farthest corner from the origin', () => {
    expect(farthestCorner({ x: 0, y: 0 }, 300, 400)).toBe(500);
    expect(farthestCorner({ x: 300, y: 400 }, 300, 400)).toBe(500);
  });

  it('ends with the solid part of the centre circle past every corner', () => {
    const origin = { x: 1100, y: 40 };
    expect(inkReach(origin, 1280, 800) * INK_SOLID).toBeGreaterThan(
      farthestCorner(origin, 1280, 800),
    );
  });
});
