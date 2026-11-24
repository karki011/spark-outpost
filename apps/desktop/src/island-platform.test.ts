import { describe, expect, it } from 'vitest';
import { dockedPosition, islandGeometry, ISLAND_WIDTH, placement } from './island-geometry.ts';
import { islandLevel, islandSupported, readsNotches, windowsDisplay } from './island-platform.ts';

const PRIMARY = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1032 },
  internal: true,
};

describe('Spark Island on Windows', () => {
  it('runs on macOS and Windows only', () => {
    expect(islandSupported('darwin')).toBe(true);
    expect(islandSupported('win32')).toBe(true);
    expect(islandSupported('linux')).toBe(false);
  });

  it('floats above the taskbar on Windows and keeps the Mac level elsewhere', () => {
    expect(islandLevel('win32')).toBe('screen-saver');
    expect(islandLevel('darwin')).toBe('status');
  });

  it('asks for notches everywhere but Windows', () => {
    expect(readsNotches('darwin')).toBe(true);
    expect(readsNotches('win32')).toBe(false);
    expect(readsNotches('linux')).toBe(true);
  });

  it('docks at the top centre of the work area, below a taskbar at the top', () => {
    const display = windowsDisplay({
      ...PRIMARY,
      workArea: { x: 0, y: 48, width: 1920, height: 1032 },
    });
    expect(dockedPosition(display)).toEqual({ x: (1920 - ISLAND_WIDTH) / 2, y: 48 });
    expect(islandGeometry(display, true, 48)).toMatchObject({
      notch: false,
      notchWidth: 0,
      menuBar: 0,
      windowTop: 0,
    });
  });

  it('centres in the work area beside a taskbar on the left', () => {
    const display = windowsDisplay({
      ...PRIMARY,
      workArea: { x: 62, y: 0, width: 1858, height: 1080 },
    });
    expect(dockedPosition(display)).toEqual({ x: 62 + (1858 - ISLAND_WIDTH) / 2, y: 0 });
  });

  it('never treats a laptop screen as notched', () => {
    const display = windowsDisplay({ ...PRIMARY, notch: { width: 200, height: 32 } });
    expect(display.notch).toBeNull();
    expect(islandGeometry(display, true).notch).toBe(false);
  });

  it('docks on the primary display when a second monitor sits to its left', () => {
    const left = windowsDisplay({
      id: 2,
      bounds: { x: -2560, y: -200, width: 2560, height: 1440 },
      workArea: { x: -2560, y: -200, width: 2560, height: 1392 },
      internal: false,
    });
    const primary = windowsDisplay(PRIMARY);
    const placed = placement({ docked: true }, [left, primary], 1, 64);
    expect(placed).toMatchObject({ docked: true, position: dockedPosition(primary) });
    const floating = placement({ docked: false, x: -1800, y: 300 }, [left, primary], 1, 64);
    expect(floating?.display.id).toBe(2);
  });
});
