import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appLockGate } from './app-lock-gate.ts';
import { handleSettingsWindowKeys, settingsWindowKey } from './settings-window-keys.ts';

vi.mock('electron', () => ({}));

function press(key: string, held: { shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
  return {
    type: 'keyDown' as const,
    key,
    control: true,
    alt: held.alt ?? false,
    shift: held.shift ?? false,
    meta: held.meta ?? false,
  };
}

describe('Settings window keys on Windows', () => {
  it('maps the main window menu keys', () => {
    expect(settingsWindowKey(press('w'))).toBe('close');
    expect(settingsWindowKey(press('W'))).toBe('close');
    expect(settingsWindowKey(press('='))).toBe('zoomIn');
    expect(settingsWindowKey(press('+', { shift: true }))).toBe('zoomIn');
    expect(settingsWindowKey(press('-'))).toBe('zoomOut');
    expect(settingsWindowKey(press('0'))).toBe('zoomReset');
    expect(settingsWindowKey(press('L', { shift: true }))).toBe('lock');
  });

  it('leaves AltGr, other modifiers, key ups and plain keys alone', () => {
    expect(settingsWindowKey(press('w', { alt: true }))).toBeNull();
    expect(settingsWindowKey(press('0', { meta: true }))).toBeNull();
    expect(settingsWindowKey({ ...press('w'), type: 'keyUp' })).toBeNull();
    expect(settingsWindowKey({ ...press('w'), control: false })).toBeNull();
    expect(settingsWindowKey(press('l'))).toBeNull();
    expect(settingsWindowKey(press('w', { shift: true }))).toBeNull();
    expect(settingsWindowKey(press('a'))).toBeNull();
  });
});

describe('handleSettingsWindowKeys', () => {
  let listener: (event: { preventDefault: () => void }, input: ReturnType<typeof press>) => void;
  const window = {
    close: vi.fn(),
    webContents: {
      zoomLevel: 0,
      on: (_name: string, next: typeof listener) => {
        listener = next;
      },
    },
  };

  beforeEach(() => {
    window.close.mockClear();
    window.webContents.zoomLevel = 0;
    handleSettingsWindowKeys(window as never);
  });

  function send(input: ReturnType<typeof press>) {
    const event = { preventDefault: vi.fn() };
    listener(event, input);
    return event.preventDefault;
  }

  it('closes and zooms the Settings window', () => {
    expect(send(press('='))).toHaveBeenCalled();
    expect(window.webContents.zoomLevel).toBe(0.5);
    send(press('-'));
    send(press('-'));
    expect(window.webContents.zoomLevel).toBe(-0.5);
    send(press('0'));
    expect(window.webContents.zoomLevel).toBe(0);
    send(press('w'));
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it('locks only while the privacy screen is on and lets other keys through', () => {
    const lockNow = vi.spyOn(appLockGate, 'lockNow');
    const available = vi.spyOn(appLockGate, 'available').mockReturnValue(false);
    expect(send(press('L', { shift: true }))).not.toHaveBeenCalled();
    expect(lockNow).not.toHaveBeenCalled();
    available.mockReturnValue(true);
    expect(send(press('L', { shift: true }))).toHaveBeenCalled();
    expect(lockNow).toHaveBeenCalledTimes(1);
    expect(send(press('a'))).not.toHaveBeenCalled();
  });
});
