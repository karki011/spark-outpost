import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { app, BrowserWindow, systemPreferences } from 'electron';
import {
  macHourCycle,
  windowsHourCycle,
  windowsShortTime,
  type HourCycle,
} from './hour-cycle-arg.ts';
import { IPC } from './ipc-channels.ts';

const CHANGED = 'AppleTimePreferencesChangedNotification';
const INTERNATIONAL = 'HKCU\\Control Panel\\International';

let windowsCycle: HourCycle | null | undefined;

function readWindowsHourCycle(): HourCycle | null {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  try {
    const output = execFileSync(
      path.win32.join(root, 'System32', 'reg.exe'),
      ['query', INTERNATIONAL, '/v', 'sShortTime'],
      { encoding: 'utf8', windowsHide: true, timeout: 5_000 },
    );
    return windowsHourCycle(windowsShortTime(output));
  } catch {
    return null;
  }
}

export function systemHourCycle(): HourCycle | null {
  if (process.platform === 'win32') {
    if (windowsCycle === undefined) windowsCycle = readWindowsHourCycle();
    return windowsCycle;
  }
  if (process.platform !== 'darwin') return null;
  return macHourCycle((key) => systemPreferences.getUserDefault(key, 'boolean') === true);
}

function sendHourCycle(cycle: HourCycle | null): void {
  for (const open of BrowserWindow.getAllWindows()) {
    if (!open.isDestroyed()) open.webContents.send(IPC.hourCycleChanged, cycle);
  }
}

function watchWindowsHourCycle(): () => void {
  const recheck = () => {
    const cycle = readWindowsHourCycle();
    if (cycle === windowsCycle) return;
    windowsCycle = cycle;
    sendHourCycle(cycle);
  };
  app.on('browser-window-focus', recheck);
  return () => app.off('browser-window-focus', recheck);
}

export function watchHourCycle(): () => void {
  if (process.platform === 'win32') return watchWindowsHourCycle();
  if (process.platform !== 'darwin') return () => undefined;
  const id = systemPreferences.subscribeNotification(CHANGED, () =>
    sendHourCycle(systemHourCycle()),
  );
  return () => systemPreferences.unsubscribeNotification(id);
}
