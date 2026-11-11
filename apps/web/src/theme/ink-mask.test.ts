import { describe, expect, it } from 'vitest';
import { farthestCorner, INK_SOLID, inkLobes, inkReach, inkVariables } from './ink-mask.ts';

describe('ink mask', () => {
  it('gives the same lobes for the same seed, off centre and uneven', () => {
    expect(inkLobes(7)).toEqual(inkLobes(7));
    expect(inkLobes(7)).not.toEqual(inkLobes(8));
    for (const lobe of inkLobes(7)) {
      expect(Math.hypot(lobe.dx, lobe.dy)).toBeGreaterThan(0.1);
      expect(lobe.size + lobe.drift).toBeLessThan(1);
    }
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

  it('names the origin and every lobe as style variables', () => {
    const variables = inkVariables({ x: 12, y: 34.56 }, 3);
    expect(variables['--ink-x']).toBe('12.0px');
    expect(variables['--ink-y']).toBe('34.6px');
    expect(Object.keys(variables)).toHaveLength(3 + 3 * 4);
    expect(Number(variables['--ink-size3'])).toBeGreaterThan(0.8);
  });
});
