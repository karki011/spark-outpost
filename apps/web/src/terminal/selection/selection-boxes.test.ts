import { describe, expect, it } from 'vitest';
import { isOutOfView, toolbarPlacement } from '../../chat/quotes/toolbar-position.ts';
import { selectionBoxes } from './selection-boxes.ts';

const screen = { left: 10, top: 100, right: 810, bottom: 580 };
const grid = { cols: 80, rows: 24, screen };
const size = { width: 300, height: 38 };

describe('selectionBoxes', () => {
  it('maps the first and last selected cells to the screen', () => {
    const boxes = selectionBoxes({
      ...grid,
      start: { x: 4, y: 2 },
      end: { x: 20, y: 3 },
      viewportY: 0,
    });
    expect(boxes).toEqual({
      start: { left: 50, right: 60, top: 140, bottom: 160 },
      end: { left: 200, right: 210, top: 160, bottom: 180 },
    });
  });

  it('follows the scrollback offset', () => {
    const boxes = selectionBoxes({
      ...grid,
      start: { x: 0, y: 1000 },
      end: { x: 5, y: 1000 },
      viewportY: 990,
    });
    expect(boxes?.start.top).toBe(300);
    expect(boxes?.end.right).toBe(60);
  });

  it('keeps a selection that ends past the last column inside the screen', () => {
    const boxes = selectionBoxes({
      ...grid,
      start: { x: 79, y: 0 },
      end: { x: 80, y: 0 },
      viewportY: 0,
    });
    expect(boxes?.start.right).toBe(810);
    expect(boxes?.end.right).toBe(810);
  });

  it('has no boxes before the terminal has a size', () => {
    const start = { x: 0, y: 0 };
    expect(selectionBoxes({ ...grid, cols: 0, start, end: start, viewportY: 0 })).toBeNull();
    const flat = { ...screen, bottom: screen.top };
    expect(selectionBoxes({ ...grid, screen: flat, start, end: start, viewportY: 0 })).toBeNull();
  });
});

describe('toolbar placement for a terminal selection', () => {
  const place = (start: { x: number; y: number }, end: { x: number; y: number }, viewportY = 0) => {
    const boxes = selectionBoxes({ ...grid, start, end, viewportY })!;
    return { boxes, placed: toolbarPlacement({ ...boxes, bounds: screen, size }) };
  };

  it('sits under the end of the selection', () => {
    const { placed } = place({ x: 30, y: 4 }, { x: 40, y: 4 });
    expect(placed).toEqual({ left: 260, top: 208, side: 'below' });
  });

  it('flips above a selection on the last row', () => {
    const { placed } = place({ x: 30, y: 23 }, { x: 40, y: 23 });
    expect(placed.side).toBe('above');
    expect(placed.top + size.height).toBeLessThanOrEqual(560);
  });

  it('stays inside the pane at both edges', () => {
    expect(place({ x: 0, y: 4 }, { x: 1, y: 4 }).placed.left).toBe(18);
    expect(place({ x: 70, y: 4 }, { x: 80, y: 4 }).placed.left).toBe(502);
  });

  it('stays inside the pane when the whole buffer is selected', () => {
    const { placed } = place({ x: 0, y: 0 }, { x: 80, y: 523 }, 500);
    expect(placed.top).toBeGreaterThanOrEqual(screen.top);
    expect(placed.top + size.height).toBeLessThanOrEqual(screen.bottom);
  });

  it('reports a selection scrolled out of the pane', () => {
    const { boxes } = place({ x: 0, y: 2 }, { x: 5, y: 3 }, 400);
    expect(isOutOfView({ ...boxes, bounds: screen })).toBe(true);
  });
});
