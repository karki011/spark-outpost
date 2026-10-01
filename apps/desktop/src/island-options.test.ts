import { describe, expect, it, vi } from 'vitest';
import { islandWindowOptions, trayBitmap, trayTemplate } from './island-options.ts';

describe('island window options', () => {
  it('is a transparent, frameless, non-focusable panel that never resizes', () => {
    const options = islandWindowOptions('/app/preload.cjs', { x: 396, y: 0 });
    expect(options).toMatchObject({
      x: 396,
      y: 0,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      type: 'panel',
    });
    expect(options.webPreferences).toMatchObject({
      preload: '/app/preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });
});

describe('tray menu', () => {
  const actions = { openSpark: vi.fn(), toggleCompanion: vi.fn(), quit: vi.fn() };

  it('offers Open, a companion toggle that reflects the setting, and Quit', () => {
    const items = trayTemplate(
      { appName: 'Spark Outpost', companionOn: false, supported: true },
      actions,
    );
    expect(items.map((item) => item.label ?? item.type)).toEqual([
      'Open Spark Outpost',
      'Show companion',
      'separator',
      'Quit Spark Outpost',
    ]);
    expect(items[1]!.checked).toBe(false);
    items[1]!.click!({} as never, undefined, {} as never);
    expect(actions.toggleCompanion).toHaveBeenCalledWith(true);
  });

  it('hides the companion toggle where the island is not available', () => {
    const items = trayTemplate({ appName: 'Spark', companionOn: false, supported: false }, actions);
    expect(items.some((item) => item.label === 'Show companion')).toBe(false);
  });

  it('draws an opaque Scout silhouette on a clear background', () => {
    const pixels = trayBitmap(36);
    const alpha = (x: number, y: number) => pixels[(y * 36 + x) * 4 + 3]!;
    expect(pixels).toHaveLength(36 * 36 * 4);
    expect(alpha(18, 24)).toBe(255);
    expect(alpha(1, 1)).toBe(0);
    expect(alpha(35, 35)).toBe(0);
  });
});
