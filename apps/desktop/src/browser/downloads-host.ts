import { app, ipcMain, shell, type DownloadItem, type IpcMainInvokeEvent } from 'electron';
import { browserDownloadActionSchema } from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import { DownloadsList, type DownloadTab } from './downloads-list.ts';
import { markQuarantined } from './quarantine.ts';

export interface DownloadsHostOptions {
  send(channel: string, payload: unknown): void;
  guarded<T>(
    run: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
  ): (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T | null>;
  log(line: string): void;
}

export interface DownloadsHost {
  decide(item: DownloadItem, tab: DownloadTab | null): boolean;
  dispose(): void;
}

export function startDownloadsHost(options: DownloadsHostOptions): DownloadsHost {
  const list = new DownloadsList({
    downloadsDir: app.getPath('downloads'),
    changed: (entries) => options.send(IPC.browserDownloadsChanged, entries),
    reveal: (filePath) => shell.showItemInFolder(filePath),
    quarantine: (filePath) => markQuarantined(filePath, app.getName()),
    log: options.log,
  });
  ipcMain.handle(
    IPC.browserDownloads,
    options.guarded(() => list.list()),
  );
  ipcMain.handle(
    IPC.browserDownloadAct,
    options.guarded((_event, raw) => {
      const { id, action } = browserDownloadActionSchema.parse(raw);
      return list.act(id, action);
    }),
  );
  return {
    decide: (item, tab) => list.decide(item, tab),
    dispose() {
      ipcMain.removeHandler(IPC.browserDownloads);
      ipcMain.removeHandler(IPC.browserDownloadAct);
    },
  };
}
