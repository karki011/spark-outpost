import { BrowserWindow, systemPreferences } from 'electron';
import { macHourCycle, type HourCycle } from './hour-cycle-arg.ts';
import { IPC } from './ipc-channels.ts';

const CHANGED = 'AppleTimePreferencesChangedNotification';

export function systemHourCycle(): HourCycle | null {
  if (process.platform !== 'darwin') return null;
  return macHourCycle((key) => systemPreferences.getUserDefault(key, 'boolean') === true);
}

export function watchHourCycle(): () => void {
  if (process.platform !== 'darwin') return () => undefined;
  const id = systemPreferences.subscribeNotification(CHANGED, () => {
    const cycle = systemHourCycle();
    for (const open of BrowserWindow.getAllWindows()) {
      if (!open.isDestroyed()) open.webContents.send(IPC.hourCycleChanged, cycle);
    }
  });
  return () => systemPreferences.unsubscribeNotification(id);
}
