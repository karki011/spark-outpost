import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type DragPhase } from './ipc-channels.ts';

function listen<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('sparkDesktop', {
  platform: process.platform,
  companion: {
    get: () => ipcRenderer.invoke(IPC.companionGet),
    setEnabled: (on: boolean) => ipcRenderer.invoke(IPC.companionSetEnabled, on),
    setShortcut: (action: string, accelerator: string | null) =>
      ipcRenderer.invoke(IPC.companionSetShortcut, action, accelerator),
    onChange: (callback: (status: unknown) => void) => listen(IPC.companionChanged, callback),
  },
  island: {
    geometry: () => ipcRenderer.invoke(IPC.islandGeometry),
    onGeometry: (callback: (geometry: unknown) => void) =>
      listen(IPC.islandGeometryChanged, callback),
    onCommand: (callback: (action: unknown) => void) => listen(IPC.islandCommand, callback),
    onEscape: (callback: () => void) => listen(IPC.islandEscape, callback),
    sparkFocused: () => ipcRenderer.invoke(IPC.islandSparkFocused),
    pickFolder: () => ipcRenderer.invoke(IPC.islandPickFolder),
    pathForFile: (file: File) => webUtils.getPathForFile(file) || null,
    onSparkFocus: (callback: (focused: unknown) => void) => listen(IPC.islandSparkFocus, callback),
    setInteractive: (on: boolean) => ipcRenderer.send(IPC.islandInteractive, on),
    setFocusable: (on: boolean) => ipcRenderer.send(IPC.islandFocusable, on),
    drag: (phase: DragPhase, x: number, y: number) => ipcRenderer.send(IPC.islandDrag, phase, x, y),
    openChat: (id: string | null) => ipcRenderer.send(IPC.islandOpenChat, id),
    setRestSize: (size: { width: number; height: number } | null) =>
      ipcRenderer.send(IPC.islandRestSize, size),
  },
  updates: {
    get: () => ipcRenderer.invoke(IPC.updatesGet),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    setChannel: (channel: string) => ipcRenderer.invoke(IPC.updatesSetChannel, channel),
    setAutoDownload: (on: boolean) => ipcRenderer.invoke(IPC.updatesSetAutoDownload, on),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    preview: () => ipcRenderer.invoke(IPC.updatesPreview),
    onChange: (callback: (status: unknown) => void) => listen(IPC.updatesChanged, callback),
  },
  help: {
    info: () => ipcRenderer.invoke(IPC.helpInfo),
    exportDiagnostics: () => ipcRenderer.invoke(IPC.helpExportDiagnostics),
    showLogs: () => ipcRenderer.invoke(IPC.helpShowLogs),
    onOpenFeedback: (callback: () => void) => {
      const take = () =>
        void ipcRenderer.invoke(IPC.helpPending).then((pending: unknown) => {
          if (pending === true) callback();
        });
      take();
      return listen(IPC.helpOpen, take);
    },
  },
  onOpenChat: (callback: (id: string) => void) => {
    const take = () =>
      void ipcRenderer.invoke(IPC.pendingChat).then((id: unknown) => {
        if (typeof id === 'string') callback(id);
      });
    take();
    return listen(IPC.openChat, take);
  },
});
