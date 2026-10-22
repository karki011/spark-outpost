import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import { IPC } from './ipc-channels.ts';

const PATH_MAX = 4096;

export interface FolderPickerOptions {
  trusted: (event: IpcMainInvokeEvent) => boolean;
  mainWindow: () => BrowserWindow | null;
}

export interface FolderPicker {
  dispose(): void;
}

export function folderDefaultPath(
  requested: unknown,
  documents: string,
  exists: (target: string) => boolean,
): string {
  const usable =
    typeof requested === 'string' &&
    requested.length <= PATH_MAX &&
    path.isAbsolute(requested) &&
    exists(requested);
  if (usable) return requested;
  return exists(documents) ? documents : homedir();
}

export function folderDialogOptions(defaultPath: string): OpenDialogOptions {
  return {
    title: 'Add folder',
    message: 'Choose a folder to add as a project, or make one with New Folder.',
    buttonLabel: 'Add Folder',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  };
}

export function startFolderPicker(options: FolderPickerOptions): FolderPicker {
  ipcMain.handle(IPC.pickFolder, async (event, requested: unknown) => {
    if (!options.trusted(event)) return null;
    const defaultPath = folderDefaultPath(requested, app.getPath('documents'), existsSync);
    const dialogOptions = folderDialogOptions(defaultPath);
    const main = options.mainWindow();
    const parent = main && main.webContents.id === event.sender.id ? main : null;
    if (!parent) app.focus({ steal: true });
    const picked = parent
      ? await dialog.showOpenDialog(parent, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  return {
    dispose() {
      ipcMain.removeHandler(IPC.pickFolder);
    },
  };
}
