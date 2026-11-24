import type { BrowserWindow, Input } from 'electron';
import { appLockGate } from './app-lock-gate.ts';
import { ZOOM_LEVEL_STEP } from './help-menu.ts';

export type SettingsWindowKey = 'close' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'lock';

type KeyInput = Pick<Input, 'type' | 'key' | 'control' | 'alt' | 'shift' | 'meta'>;

export function settingsWindowKey(input: KeyInput): SettingsWindowKey | null {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return null;
  const key = input.key.toLowerCase();
  if (input.shift) {
    if (key === 'l') return 'lock';
    return key === '+' || key === '=' ? 'zoomIn' : null;
  }
  if (key === 'w') return 'close';
  if (key === '=' || key === '+') return 'zoomIn';
  if (key === '-') return 'zoomOut';
  return key === '0' ? 'zoomReset' : null;
}

function run(window: BrowserWindow, key: SettingsWindowKey): boolean {
  const contents = window.webContents;
  if (key === 'close') window.close();
  else if (key === 'zoomIn') contents.zoomLevel += ZOOM_LEVEL_STEP;
  else if (key === 'zoomOut') contents.zoomLevel -= ZOOM_LEVEL_STEP;
  else if (key === 'zoomReset') contents.zoomLevel = 0;
  else if (appLockGate.available()) appLockGate.lockNow();
  else return false;
  return true;
}

export function handleSettingsWindowKeys(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    const key = settingsWindowKey(input);
    if (key && run(window, key)) event.preventDefault();
  });
}
