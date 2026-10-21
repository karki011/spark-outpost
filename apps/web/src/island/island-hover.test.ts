import { describe, expect, it } from 'vitest';
import { PASS_SPEED, pointerIntent, pointerSpeed } from './island-hover.ts';

const MENU_BAR = 24;

describe('reading what the pointer means', () => {
  it('measures speed between two samples, and calls a first sample still', () => {
    expect(pointerSpeed(null, { x: 10, y: 10, at: 0 })).toBe(0);
    expect(pointerSpeed({ x: 0, y: 0, at: 0 }, { x: 300, y: 400, at: 100 })).toBe(5);
  });

  it('treats a fast crossing of the notch toward the menu items as passing, not hover', () => {
    const crossing = pointerSpeed({ x: 600, y: 12, at: 0 }, { x: 700, y: 12, at: 40 });
    expect(crossing).toBeGreaterThan(PASS_SPEED);
    expect(pointerIntent({ onIsland: true, speed: crossing, y: 12, menuBar: MENU_BAR })).toBe(
      'passing',
    );
  });

  it('hovers when the pointer rests inside the island', () => {
    expect(pointerIntent({ onIsland: true, speed: 0.1, y: 12, menuBar: MENU_BAR })).toBe('hover');
  });

  it('marks the menu bar row beside the island as menu bar use, and anything below as away', () => {
    expect(pointerIntent({ onIsland: false, speed: 0, y: 10, menuBar: MENU_BAR })).toBe('menu-bar');
    expect(pointerIntent({ onIsland: false, speed: 0, y: 300, menuBar: MENU_BAR })).toBe('away');
  });
});
