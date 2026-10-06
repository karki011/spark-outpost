import { describe, expect, it } from 'vitest';
import { emulatedNotch, parseNotches } from './notch-probe.ts';

describe('notch probe', () => {
  it('reads the notch as the gap between the two top areas', () => {
    const notches = parseNotches(
      JSON.stringify([
        { id: 1, width: 1512, top: 32, left: 663.5, right: 663.5 },
        { id: 2, width: 2560, top: 0, left: 0, right: 0 },
      ]),
    );
    expect(notches.get(1)).toEqual({ width: 185, height: 32 });
    expect(notches.get(2)).toBeNull();
    expect(notches.has(3)).toBe(false);
  });

  it('covers an off-centre notch from the middle of the display', () => {
    const notches = parseNotches(
      JSON.stringify([{ id: 1, width: 1512, top: 32, left: 660, right: 670 }]),
    );
    expect(notches.get(1)).toEqual({ width: 192, height: 32 });
  });

  it('ignores output it cannot trust', () => {
    expect(parseNotches('').size).toBe(0);
    expect(parseNotches('{"id":1}').size).toBe(0);
    expect(parseNotches(JSON.stringify([null, { id: 'x' }, 4])).size).toBe(0);
    const odd = parseNotches(
      JSON.stringify([
        { id: 1, width: 1512, top: 32, left: 10, right: 10 },
        { id: 2, width: 1512, top: 400, left: 663, right: 663 },
        { id: 3, width: '1512', top: 32, left: 663, right: 663 },
      ]),
    );
    expect([odd.get(1), odd.get(2), odd.get(3)]).toEqual([null, null, null]);
  });

  it('reads a development notch as width by height', () => {
    expect(emulatedNotch('200x38')).toEqual({ width: 200, height: 38 });
    expect(emulatedNotch(undefined)).toBeNull();
    expect(emulatedNotch('wide')).toBeNull();
    expect(emulatedNotch('2000x38')).toBeNull();
  });
});
