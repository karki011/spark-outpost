import { describe, expect, it } from 'vitest';
import { arcPoint, curvePoint, handOf, heroHue, STAGE } from './rally.ts';

describe('rally', () => {
  it('throws from one hand to the other, peaking halfway', () => {
    const from = handOf('left');
    const to = handOf('right');
    expect(arcPoint(from, to, STAGE.arc, 0)).toEqual(from);
    expect(arcPoint(from, to, STAGE.arc, 1)).toEqual(to);
    expect(arcPoint(from, to, STAGE.arc, 0.5).y).toBe(from.y - STAGE.arc);
  });

  it('flies the hero along a curve that ends where it aims', () => {
    const end = { x: 90, y: 120 };
    expect(curvePoint({ x: -50, y: -40 }, { x: 20, y: 140 }, end, 1)).toEqual(end);
  });

  it('never dresses the hero in a provider colour', () => {
    for (const roll of [0, 0.07, 0.31, 0.57, 0.88, 0.999]) {
      const hue = heroHue(() => roll);
      expect([24, 112, 205, 318].every((taken) => Math.abs(taken - hue) >= 25)).toBe(true);
    }
  });
});
