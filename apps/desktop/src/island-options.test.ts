import { describe, expect, it, vi } from 'vitest';
import { islandToggle, islandWindowOptions, trayTemplate } from './island-options.ts';

describe('island window options', () => {
  it('is a transparent, frameless, non-focusable panel that never resizes', () => {
    const options = islandWindowOptions('/app/preload.cjs', { x: 396, y: 0 }, []);
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
      'Show Spark Island',
      'separator',
      'Quit Spark Outpost',
    ]);
    expect(items[1]!.checked).toBe(false);
    items[1]!.click!({} as never, undefined, {} as never);
    expect(actions.toggleCompanion).toHaveBeenCalledWith(true);
  });

  it('hides the companion toggle where the island is not available', () => {
    const items = trayTemplate({ appName: 'Spark', companionOn: false, supported: false }, actions);
    expect(items.some((item) => item.label === 'Show Spark Island')).toBe(false);
  });

  it('gives the Dock menu the same Spark Island toggle on its own', () => {
    const toggle = vi.fn();
    const items = islandToggle({ appName: 'Spark', companionOn: true, supported: true }, toggle);
    expect(items.map((item) => item.label)).toEqual(['Show Spark Island']);
    expect(items[0]!.checked).toBe(true);
    items[0]!.click!({} as never, undefined, {} as never);
    expect(toggle).toHaveBeenCalledWith(false);
    expect(islandToggle({ appName: 'Spark', companionOn: true, supported: false }, toggle)).toEqual(
      [],
    );
  });
});
