import { describe, expect, it } from 'vitest';
import { BLOB_OVERSHOOT, farthestCorner, inkBlob, inkFrames } from './ink-blob.ts';

const pointsOf = (polygon: string) =>
  polygon
    .slice('polygon('.length, -1)
    .split(', ')
    .map((pair) => pair.split(' ').map((value) => Number.parseFloat(value)) as [number, number]);

describe('ink blob', () => {
  it('starts as a point at the origin', () => {
    const points = pointsOf(inkBlob({ x: 120, y: 80 }, 0, 3));
    expect(points.every(([x, y]) => x === 120 && y === 80)).toBe(true);
  });

  it('is lopsided, and the same seed gives the same shape', () => {
    const origin = { x: 0, y: 0 };
    const distances = pointsOf(inkBlob(origin, 100, 7)).map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(10);
    expect(inkBlob(origin, 100, 7)).toBe(inkBlob(origin, 100, 7));
    expect(inkBlob(origin, 100, 7)).not.toBe(inkBlob(origin, 100, 8));
  });

  it('measures to the farthest corner from the origin', () => {
    expect(farthestCorner({ x: 0, y: 0 }, 300, 400)).toBe(500);
    expect(farthestCorner({ x: 300, y: 400 }, 300, 400)).toBe(500);
  });

  it('keeps one point count across frames and ends past every corner', () => {
    const origin = { x: 1100, y: 40 };
    const frames = inkFrames(origin, 1280, 800, 5).map(pointsOf);
    expect(new Set(frames.map((frame) => frame.length)).size).toBe(1);
    const corner = farthestCorner(origin, 1280, 800);
    const last = frames.at(-1)!.map(([x, y]) => Math.hypot(x - origin.x, y - origin.y));
    expect(Math.min(...last)).toBeGreaterThanOrEqual(corner);
    expect(BLOB_OVERSHOOT).toBeGreaterThan(1);
  });
});
