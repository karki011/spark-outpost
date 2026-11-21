import { describe, expect, it } from 'vitest';
import { DEVTOOLS_GAP, dockDevtools } from './devtools-dock.ts';

describe('dockDevtools', () => {
  it('puts developer tools under the page inside the same bounds', () => {
    const bounds = { x: 400, y: 90, width: 800, height: 601 };
    const { page, devtools } = dockDevtools(bounds);
    expect(page).toEqual({ x: 400, y: 90, width: 800, height: 330 });
    expect(devtools).toEqual({ x: 400, y: 421, width: 800, height: 270 });
    expect(page.height + DEVTOOLS_GAP + devtools.height).toBe(bounds.height);
  });

  it('keeps the page a minimum height and never leaves the bounds', () => {
    const { page, devtools } = dockDevtools({ x: 0, y: 10, width: 300, height: 100 });
    expect(page.height).toBe(80);
    expect(devtools).toEqual({ x: 0, y: 91, width: 300, height: 19 });
    const tiny = dockDevtools({ x: 0, y: 0, width: 300, height: 40 });
    expect(tiny.page.height).toBe(39);
    expect(tiny.devtools.height).toBe(0);
  });
});
