import { describe, expect, it } from 'vitest';
import { clampStart } from './viewport-clamp.ts';

describe('clampStart', () => {
  it('leaves a box that already fits where it is', () => {
    expect(clampStart(100, 200, 844)).toBe(100);
  });

  it('pulls a box back from the far edge', () => {
    expect(clampStart(700, 240, 844)).toBe(596);
    expect(clampStart(160, 270, 390)).toBe(112);
  });

  it('pushes a box in from the near edge', () => {
    expect(clampStart(-30, 240, 390)).toBe(8);
  });

  it('pins a box larger than the screen to the near margin', () => {
    expect(clampStart(40, 441, 390)).toBe(8);
  });
});
