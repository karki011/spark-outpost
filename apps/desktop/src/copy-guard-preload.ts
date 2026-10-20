import { contextBridge, ipcRenderer } from 'electron';
import { guardCopyInPage } from './browser/copy-guard-page.ts';
import { IPC } from './ipc-channels.ts';

contextBridge.executeInMainWorld({
  func: guardCopyInPage,
  args: [() => ipcRenderer.sendSync(IPC.browserPageCopyAllowed) === true],
});
