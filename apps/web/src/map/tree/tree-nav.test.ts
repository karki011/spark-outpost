import { describe, expect, it } from 'vitest';
import { nearest, type NavBox } from './tree-nav.ts';

const box = (id: string, x: number, y: number): NavBox => ({ id, x, y, width: 100, height: 50 });
const boxes = [
  box('mid', 200, 200),
  box('right', 400, 210),
  box('far-right', 700, 200),
  box('up', 190, 0),
  box('diag', 330, 20),
  box('left', 0, 200),
  box('down', 200, 400),
];

describe('nearest', () => {
  it('moves to the closest box in the pressed direction, preferring straight lines', () => {
    expect(nearest(boxes, 'mid', 'right')).toBe('right');
    expect(nearest(boxes, 'mid', 'left')).toBe('left');
    expect(nearest(boxes, 'mid', 'up')).toBe('up');
    expect(nearest(boxes, 'mid', 'down')).toBe('down');
    expect(nearest(boxes, 'right', 'right')).toBe('far-right');
  });

  it('stays put at the edge and starts from the first box when nothing is active', () => {
    expect(nearest(boxes, 'far-right', 'right')).toBeNull();
    expect(nearest(boxes, 'missing', 'down')).toBe('mid');
  });
});
