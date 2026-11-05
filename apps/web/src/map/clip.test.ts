import { describe, expect, it } from 'vitest';
import { clipSegment, visibleArc } from './clip.ts';

describe('clipSegment', () => {
  it('trims a long line to the visible box plus a margin', () => {
    const clipped = clipSegment([-1000, 50], [1000, 50], 200, 100, 0)!;
    expect(clipped).toEqual([
      [0, 50],
      [200, 50],
    ]);
  });

  it('drops lines that never cross the view', () => {
    expect(clipSegment([-50, -50], [-10, 500], 200, 100, 0)).toBeNull();
  });
});

describe('visibleArc', () => {
  it('draws the whole ring when its centre is on screen', () => {
    expect(visibleArc(100, 50, 30, 200, 100)).toEqual([0, Math.PI * 2]);
  });

  it('skips rings that miss the view or surround it', () => {
    expect(visibleArc(1000, 50, 30, 200, 100)).toBeNull();
    expect(visibleArc(100, 50, 5000, 200, 100)).toBeNull();
  });

  it('keeps only the part of a huge ring that crosses the view', () => {
    const [start, end] = visibleArc(100, 3050, 3000, 200, 100)!;
    expect(end - start).toBeLessThan(0.2);
    const mid = (start + end) / 2;
    expect(Math.sin(mid)).toBeLessThan(-0.99);
  });
});
