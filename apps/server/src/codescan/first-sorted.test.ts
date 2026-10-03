import { describe, expect, it } from 'vitest';
import { firstSorted } from './first-sorted.ts';

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

interface Entry {
  path: string;
  weight: number;
}

const byWeightThenPath = (a: Entry, b: Entry) =>
  b.weight - a.weight || a.path.localeCompare(b.path);

function entries(count: number, distinctWeights: number, seed: number): Entry[] {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, index) => ({
    path: `src/${Math.floor(random() * 50)}/File-${Math.floor(random() * count)}-${index}.ts`,
    weight: Math.floor(random() * distinctWeights),
  }));
}

describe('firstSorted', () => {
  it('returns the same first items as sorting everything', () => {
    for (const [count, weights, take] of [
      [1, 1, 1],
      [10, 3, 4],
      [500, 1, 30],
      [500, 4, 300],
      [2_000, 2, 255],
      [2_000, 1_000, 300],
      [5_000, 1, 1],
    ] as const) {
      for (const seed of [1, 7, 99]) {
        const items = entries(count, weights, seed);
        const expected = [...items].sort(byWeightThenPath).slice(0, take);
        expect(firstSorted(items, take, byWeightThenPath)).toEqual(expected);
      }
    }
  });

  it('keeps the earlier of two items that compare equal, like a stable sort', () => {
    const items = Array.from({ length: 400 }, (_, index) => ({ id: index, group: index % 3 }));
    const byGroup = (a: { group: number }, b: { group: number }) => a.group - b.group;
    const expected = [...items].sort(byGroup).slice(0, 150);
    expect(firstSorted(items, 150, byGroup)).toEqual(expected);
  });

  it('sorts everything when asked for at least as many as there are', () => {
    const items = entries(20, 5, 3);
    const expected = [...items].sort(byWeightThenPath);
    expect(firstSorted(items, 20, byWeightThenPath)).toEqual(expected);
    expect(firstSorted(items, 50, byWeightThenPath)).toEqual(expected);
    expect(firstSorted(items, 0, byWeightThenPath)).toEqual([]);
    expect(firstSorted([], 5, byWeightThenPath)).toEqual([]);
  });

  it('leaves the input as it was', () => {
    const items = entries(300, 2, 5);
    const copy = [...items];
    firstSorted(items, 10, byWeightThenPath);
    expect(items).toEqual(copy);
  });
});
