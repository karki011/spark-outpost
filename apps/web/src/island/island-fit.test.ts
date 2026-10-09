import { describe, expect, it } from 'vitest';
import type { IslandGeometry } from '../desktop/desktop-bridge.ts';
import { notchFit, stripHeight } from './island-fit.ts';

const notched: IslandGeometry = {
  notch: true,
  top: 44,
  notchWidth: 220,
  notchHeight: 38,
  docked: true,
  menuBar: 44,
};

describe('island fit under the notch', () => {
  it('keeps the whole notch when the window is at the top of the screen', () => {
    const expected = { hugsNotch: true, strip: 44, notchHeight: 38 };
    expect(notchFit(notched)).toEqual(expected);
    expect(notchFit({ ...notched, windowTop: 0 })).toEqual(expected);
    expect(notchFit({ ...notched, windowTop: -6 })).toEqual(expected);
    expect(stripHeight(notchFit(notched), true)).toBe(44);
    expect(stripHeight(notchFit(notched), false)).toBe(44);
  });

  it('counts only the part of the notch that reaches into a lowered window', () => {
    expect(notchFit({ ...notched, windowTop: 10 })).toEqual({
      hugsNotch: true,
      strip: 34,
      notchHeight: 28,
    });
    expect(notchFit({ ...notched, windowTop: 38 }).notchHeight).toBe(0);
    expect(notchFit({ ...notched, windowTop: 44 })).toEqual({
      hugsNotch: true,
      strip: 0,
      notchHeight: 0,
    });
    expect(notchFit({ ...notched, windowTop: 60 }).notchHeight).toBe(0);
  });

  it('falls back to the bar height when the notch height is not sent', () => {
    const old = { notch: true, top: 38, notchWidth: 190, docked: true, menuBar: 38 };
    expect(notchFit({ ...old, windowTop: 8 })).toEqual({
      hugsNotch: true,
      strip: 30,
      notchHeight: 30,
    });
  });

  it('ignores the notch and the window offset away from the dock or on a flat display', () => {
    expect(notchFit({ ...notched, docked: false, windowTop: 38 })).toEqual({
      hugsNotch: false,
      strip: 44,
      notchHeight: 0,
    });
    const flat = { ...notched, notch: false, top: 24, notchWidth: 0, notchHeight: 0 };
    expect(notchFit({ ...flat, windowTop: 24 })).toEqual({
      hugsNotch: false,
      strip: 24,
      notchHeight: 0,
    });
  });

  it('gives the resting blob no strip and an open view a usable one below the notch', () => {
    const below = notchFit({ ...notched, windowTop: 44 });
    expect(stripHeight(below, true)).toBe(0);
    expect(stripHeight(below, false)).toBe(24);
    expect(stripHeight(notchFit({ ...notched, windowTop: 60 }), true)).toBe(0);
  });
});
