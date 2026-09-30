import { describe, expect, it } from 'vitest';
import { between, fit, toScreenX, toScreenY, toWorld, visibleBox, zoomAt } from './camera.ts';

const viewport = { width: 1000, height: 600, inset: 0 };

describe('camera', () => {
  it('fits a box inside the viewport with padding', () => {
    const camera = fit([-500, -300, 500, 300], viewport, 20);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(toScreenX(camera, viewport, 500)).toBeLessThanOrEqual(980);
    expect(toScreenY(camera, viewport, 300)).toBeLessThanOrEqual(580);
  });

  it('keeps the fitted box clear of a side panel', () => {
    const narrowed = { ...viewport, inset: 400 };
    const camera = fit([-100, -100, 100, 100], narrowed, 20);
    expect(toScreenX(camera, narrowed, 100)).toBeLessThanOrEqual(600 - 20 + 1e-9);
    expect(toScreenX(camera, narrowed, -100)).toBeGreaterThanOrEqual(20 - 1e-9);
  });

  it('zooms about the pointer so the point under it stays put', () => {
    const camera = { x: 40, y: -20, k: 1.5 };
    const before = toWorld(camera, viewport, 700, 150);
    const after = zoomAt(camera, viewport, 700, 150, 4);
    const moved = toWorld(after, viewport, 700, 150);
    expect(moved.x).toBeCloseTo(before.x);
    expect(moved.y).toBeCloseTo(before.y);
  });

  it('interpolates zoom on a log scale and ends exactly at the target', () => {
    const from = { x: 0, y: 0, k: 1 };
    const to = { x: 100, y: 50, k: 4 };
    expect(between(from, to, 0.5).k).toBeCloseTo(2);
    expect(between(from, to, 1)).toEqual(to);
  });

  it('reports the visible world box, minus the panel', () => {
    const box = visibleBox({ x: 0, y: 0, k: 1 }, { ...viewport, inset: 200 });
    expect(box).toEqual([-500, -300, 300, 300]);
  });
});
