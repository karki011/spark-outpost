import { describe, expect, it } from 'vitest';
import { scrollToShow, tickAfterKey, tickReach } from './tick-model.ts';

describe('tickReach', () => {
  it('grades the current tick and two neighbours on each side', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => tickReach(index, 3))).toEqual([
      null,
      2,
      1,
      0,
      1,
      2,
      null,
    ]);
  });

  it('grades nothing before a turn is in view', () => {
    expect(tickReach(0, -1)).toBeNull();
  });
});

describe('tickAfterKey', () => {
  it('moves by one and stops at the ends', () => {
    expect(tickAfterKey('ArrowDown', 1, 4)).toBe(2);
    expect(tickAfterKey('ArrowDown', 3, 4)).toBe(3);
    expect(tickAfterKey('ArrowUp', 1, 4)).toBe(0);
    expect(tickAfterKey('ArrowUp', 0, 4)).toBe(0);
  });

  it('jumps to the first and last tick and ignores other keys', () => {
    expect(tickAfterKey('Home', 2, 4)).toBe(0);
    expect(tickAfterKey('End', 2, 4)).toBe(3);
    expect(tickAfterKey('a', 2, 4)).toBeNull();
    expect(tickAfterKey('End', 0, 0)).toBeNull();
  });
});

describe('scrollToShow', () => {
  const strip = { scrollTop: 100, height: 200 };

  it('leaves the strip alone when the tick is visible', () => {
    expect(scrollToShow(strip, 150, 4)).toBe(100);
  });

  it('scrolls just far enough to show a tick above or below', () => {
    expect(scrollToShow(strip, 40, 4)).toBe(40);
    expect(scrollToShow(strip, 400, 4)).toBe(204);
  });
});
