import { describe, expect, it } from 'vitest';
import { placeLabels, splitName, type LabelRequest } from './labels.ts';

const area = { width: 800, height: 600 };

function request(id: number, x: number, y: number, priority = 1): LabelRequest {
  return { id, x, y, r: 20, width: 90, height: 16, priority };
}

function rect(placement: { x: number; y: number; width: number; height: number }) {
  return [
    placement.x - placement.width / 2,
    placement.y - placement.height / 2,
    placement.x + placement.width / 2,
    placement.y + placement.height / 2,
  ];
}

function overlaps(a: number[], b: number[]) {
  return a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;
}

describe('placeLabels', () => {
  it('moves crowded labels apart instead of stacking them', () => {
    const placements = placeLabels([request(1, 400, 300), request(2, 410, 305)], [], area);
    const shown = placements.filter((p) => !p.hidden);
    expect(shown).toHaveLength(2);
    expect(overlaps(rect(shown[0]!), rect(shown[1]!))).toBe(false);
  });

  it('hides the less important label when there is no free spot', () => {
    const many = Array.from({ length: 20 }, (_, i) => request(i, 400, 300, i));
    const placements = placeLabels(many, [], { width: 300 + 400, height: 330 });
    const shown = placements.filter((p) => !p.hidden);
    for (const a of shown) {
      for (const b of shown) if (a !== b) expect(overlaps(rect(a), rect(b))).toBe(false);
    }
    expect(placements.find((p) => p.id === 19)!.hidden).toBe(false);
    expect(placements.some((p) => p.hidden)).toBe(true);
  });

  it('keeps labels inside the visible area when a side panel narrows it', () => {
    const placements = placeLabels([request(1, 590, 300)], [], { width: 600, height: 600 });
    const [left, , right] = rect(placements[0]!);
    expect(placements[0]!.hidden).toBe(false);
    expect(right).toBeLessThanOrEqual(598);
    expect(left).toBeGreaterThan(0);
  });

  it('hides labels whose area is behind the panel', () => {
    const placements = placeLabels([request(1, 700, 300)], [], { width: 500, height: 600 });
    expect(placements[0]!.hidden).toBe(true);
  });

  it('prefers spots that cover no stars', () => {
    const stars = Array.from({ length: 12 }, (_, i) => ({ x: 356 + i * 8, y: 280, weight: 4 }));
    const [placement] = placeLabels([request(1, 400, 300)], stars, area);
    const [left, top, right, bottom] = rect(placement!);
    const covered = stars.filter((s) => s.x > left! && s.x < right! && s.y > top! && s.y < bottom!);
    expect(covered).toEqual([]);
  });

  it('keeps clear of reserved rectangles', () => {
    const [placement] = placeLabels([request(1, 400, 300)], [], area, [[300, 200, 500, 300]]);
    expect(overlaps(rect(placement!), [300, 200, 500, 300])).toBe(false);
  });
});

describe('splitName', () => {
  it('splits long names into two balanced lines', () => {
    expect(splitName('APPROVALS & AUDIT')).toEqual(['APPROVALS', '& AUDIT']);
    expect(splitName('CHAT')).toEqual(['CHAT']);
  });
});
