import { describe, expect, it } from 'vitest';
import { TOOLBAR_GAP, isOutOfView, toolbarPlacement } from './toolbar-position.ts';

const bounds = { left: 100, right: 800, top: 50, bottom: 650 };
const size = { width: 300, height: 40 };
const line = (left: number, top: number, right = left + 100) => ({
  left,
  right,
  top,
  bottom: top + 20,
});

describe('toolbarPlacement', () => {
  it('sits below the end of the selection, centred on its last character', () => {
    const placed = toolbarPlacement({ start: line(300, 100), end: line(300, 120), bounds, size });
    expect(placed).toEqual({ left: 250, top: 140 + TOOLBAR_GAP, side: 'below' });
  });

  it('flips above the selection near the bottom of the thread', () => {
    const placed = toolbarPlacement({ start: line(300, 560), end: line(300, 600), bounds, size });
    expect(placed.side).toBe('above');
    expect(placed.top).toBe(560 - TOOLBAR_GAP - size.height);
  });

  it('stays inside the chat column at both edges', () => {
    expect(
      toolbarPlacement({ start: line(90, 100), end: line(90, 100, 110), bounds, size }).left,
    ).toBe(108);
    expect(
      toolbarPlacement({ start: line(700, 100), end: line(700, 100, 790), bounds, size }).left,
    ).toBe(492);
  });

  it('keeps to the left edge when the column is narrower than the toolbar', () => {
    const narrow = { ...bounds, right: 300 };
    expect(
      toolbarPlacement({ start: line(150, 100), end: line(150, 100), bounds: narrow, size }).left,
    ).toBe(108);
  });

  it('knows when the selection has scrolled out of view', () => {
    expect(isOutOfView({ start: line(0, 10), end: line(0, 20), bounds })).toBe(true);
    expect(isOutOfView({ start: line(0, 700), end: line(0, 720), bounds })).toBe(true);
    expect(isOutOfView({ start: line(0, 40), end: line(0, 60), bounds })).toBe(false);
  });
});
