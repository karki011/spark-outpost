import { describe, expect, it } from 'vitest';
import {
  clampDetailWidth,
  DETAIL_MAX_WIDTH,
  DETAIL_MIN_WIDTH,
  parseDetailWidth,
} from './detail-width.ts';

describe('ticket detail width', () => {
  it('stays between the narrowest and widest pane', () => {
    expect(clampDetailWidth(100)).toBe(DETAIL_MIN_WIDTH);
    expect(clampDetailWidth(5000)).toBe(DETAIL_MAX_WIDTH);
    expect(clampDetailWidth(512.4)).toBe(512);
  });

  it('reads a remembered width and ignores anything else', () => {
    expect(parseDetailWidth('560')).toBe(560);
    expect(parseDetailWidth('90')).toBe(DETAIL_MIN_WIDTH);
    expect(parseDetailWidth(null)).toBeNull();
    expect(parseDetailWidth('')).toBeNull();
    expect(parseDetailWidth('wide')).toBeNull();
  });
});
