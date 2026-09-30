import { describe, expect, it } from 'vitest';
import { constellation, starCount } from './constellation.ts';

describe('constellation', () => {
  it('scales the number of stars with the area and caps it', () => {
    expect(starCount(1)).toBe(1);
    expect(starCount(4)).toBe(3);
    expect(starCount(49)).toBe(10);
    expect(starCount(5000)).toBe(10);
  });

  it('joins bright files along imports, starting at the brightest, as a tree', () => {
    const importance = [1, 0.2, 0.9, 0.5, 0.1, 0.8];
    const links: Record<number, number[]> = { 0: [1, 2, 3], 1: [0], 2: [0, 5], 3: [0], 5: [2] };
    const result = constellation(
      [0, 1, 2, 3, 4, 5],
      (i) => importance[i]!,
      (i) => links[i] ?? [],
    );
    expect(result.stars[0]).toBe(0);
    expect(result.stars).toContain(2);
    expect(result.tree).toHaveLength(result.stars.length - 1);
    expect(result.stars).not.toContain(4);
  });

  it('keeps each star to three lines so shapes stay chain-like', () => {
    const files = Array.from({ length: 60 }, (_, i) => i);
    const hub = (i: number) => (i === 0 ? files.slice(1) : [0]);
    const result = constellation(files, (i) => 100 - i, hub);
    const degree = new Map<number, number>();
    for (const [a, b] of result.tree) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
    expect(Math.max(...degree.values())).toBeLessThanOrEqual(3);
  });
});
