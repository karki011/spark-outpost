import { describe, expect, it } from 'vitest';
import { FAR_POLL_MS, NEAR_POLL_MS, pointerOnIsland, pollDelay } from './island-pointer.ts';

const full = { x: 760, y: 0, width: 1040, height: 600 };
const strip = { x: 966, y: 0, width: 628, height: 67 };
const regions = {
  width: 1040,
  boxes: [{ x: 787, y: 30, width: 62, height: 20 }],
  scout: null,
};

describe('pointerOnIsland', () => {
  it('hits a region where the page measured it', () => {
    expect(pointerOnIsland({ x: 760 + 800, y: 40 }, full, regions)).toBe(true);
    expect(pointerOnIsland({ x: 760 + 780, y: 40 }, full, regions)).toBe(false);
  });

  it('keeps the same screen spot after the window narrows round its centre', () => {
    expect(pointerOnIsland({ x: 760 + 800, y: 40 }, strip, regions)).toBe(true);
    expect(pointerOnIsland({ x: 760 + 780, y: 40 }, strip, regions)).toBe(false);
  });

  it('never hits outside the window', () => {
    const wide = { ...regions, boxes: [{ x: -50, y: 0, width: 2000, height: 600 }] };
    expect(pointerOnIsland({ x: 700, y: 40 }, full, wide)).toBe(false);
  });
});

describe('pollDelay', () => {
  it('polls often near the island and rarely far from it', () => {
    expect(pollDelay({ x: 1200, y: 100 }, strip)).toBe(NEAR_POLL_MS);
    expect(pollDelay({ x: 1200, y: 200 }, strip)).toBe(NEAR_POLL_MS);
    expect(pollDelay({ x: 1200, y: 900 }, strip)).toBe(FAR_POLL_MS);
    expect(pollDelay({ x: 100, y: 10 }, strip)).toBe(FAR_POLL_MS);
  });
});
