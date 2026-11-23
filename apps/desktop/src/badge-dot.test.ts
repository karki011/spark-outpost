import { describe, expect, it } from 'vitest';
import { badgeDotPixels, BADGE_DOT_SIZE } from './badge-dot.ts';

function pixel(pixels: Buffer, x: number, y: number): number[] {
  const offset = (y * BADGE_DOT_SIZE + x) * 4;
  return [...pixels.subarray(offset, offset + 4)];
}

describe('badgeDotPixels', () => {
  const pixels = badgeDotPixels(BADGE_DOT_SIZE);

  it('holds one BGRA pixel per point', () => {
    expect(pixels.length).toBe(BADGE_DOT_SIZE * BADGE_DOT_SIZE * 4);
  });

  it('draws an opaque red dot with clear corners', () => {
    expect(pixel(pixels, 8, 8)).toEqual([0x1c, 0x2b, 0xc4, 255]);
    expect(pixel(pixels, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(pixels, BADGE_DOT_SIZE - 1, BADGE_DOT_SIZE - 1)).toEqual([0, 0, 0, 0]);
  });

  it('premultiplies colour by alpha on the soft edge', () => {
    const [blue, green, red, alpha] = pixel(pixels, 8, 0);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
    expect(red).toBeLessThanOrEqual(alpha!);
    expect(blue).toBeLessThanOrEqual(red!);
    expect(green).toBeLessThanOrEqual(red!);
  });
});
