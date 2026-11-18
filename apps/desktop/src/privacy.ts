import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL } from '@spark-outpost/contracts';
import { startAppLock } from './app-lock-host.ts';
import { IPC } from './ipc-channels.ts';

export interface PrivacyOptions {
  trusted: (event: IpcMainInvokeEvent) => boolean;
  userData: string;
  log: (line: string) => void;
}

export interface Privacy {
  dispose(): void;
}

export function openFullDiskAccess(trusted: boolean, openExternal: (url: string) => void): void {
  if (!trusted) return;
  openExternal(FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL);
}

export function startPrivacy(options: PrivacyOptions): Privacy {
  ipcMain.handle(IPC.privacyOpenFullDiskAccess, (event) => {
    openFullDiskAccess(options.trusted(event), (url) => void shell.openExternal(url));
  });
  const appLock = startAppLock(options);
  return {
    dispose() {
      appLock.dispose();
      ipcMain.removeHandler(IPC.privacyOpenFullDiskAccess);
    },
  };
}
