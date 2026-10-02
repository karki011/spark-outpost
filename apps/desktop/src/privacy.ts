import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL } from '@spark-outpost/contracts';
import { IPC } from './ipc-channels.ts';

export interface PrivacyOptions {
  trusted: (event: IpcMainInvokeEvent) => boolean;
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
  return {
    dispose() {
      ipcMain.removeHandler(IPC.privacyOpenFullDiskAccess);
    },
  };
}
