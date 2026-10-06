import { describe, expect, it } from 'vitest';
import { keyboardCovers } from './touch-viewport.ts';

describe('keyboardCovers', () => {
  it('reads a large drop in visible height as the keyboard', () => {
    expect(keyboardCovers(844, 508)).toBe(true);
    expect(keyboardCovers(390, 190)).toBe(true);
  });

  it('ignores browser toolbars sliding in and out', () => {
    expect(keyboardCovers(844, 760)).toBe(false);
    expect(keyboardCovers(844, 844)).toBe(false);
  });
});
