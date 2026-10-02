import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels.ts';

let status: string | null = null;
let onStatus: ((text: string) => void) | null = null;
let leaving = false;
let onLeave: (() => void) | null = null;

ipcRenderer.on(IPC.bootStatus, (_event, text: unknown) => {
  if (typeof text !== 'string') return;
  status = text;
  onStatus?.(text);
});
ipcRenderer.on(IPC.bootLeave, () => {
  leaving = true;
  onLeave?.();
});

contextBridge.exposeInMainWorld('sparkBoot', {
  onStatus: (callback: (text: string) => void) => {
    onStatus = callback;
    if (status !== null) callback(status);
  },
  onLeave: (callback: () => void) => {
    onLeave = callback;
    if (leaving) callback();
  },
  painted: () => ipcRenderer.send(IPC.bootPainted),
});
