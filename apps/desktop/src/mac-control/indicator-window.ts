import { BrowserWindow, screen } from 'electron';
import type { MacIndicator } from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import { guardNavigation } from '../window.ts';

export const MAC_INDICATOR_PATH = '/mac-indicator';
const WIDTH = 360;
const HEIGHT = 64;
const MARGIN = 12;

export interface MacIndicatorWindow {
  show(state: MacIndicator | null): void;
  owns(webContentsId: number): boolean;
  dispose(): void;
}

function topRight(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - WIDTH - MARGIN, y: area.y + MARGIN };
}

function createWindow(origin: string, preload: string): BrowserWindow {
  const window = new BrowserWindow({
    ...topRight(),
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hiddenInMissionControl: true,
    type: 'panel',
    title: 'Spark is controlling an app',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.setAlwaysOnTop(true, 'floating');
  window.setContentProtection(true);
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  guardNavigation(window, origin);
  void window.loadURL(`${origin}${MAC_INDICATOR_PATH}`);
  return window;
}

export function openMacIndicator(origin: () => string | null, preload: string): MacIndicatorWindow {
  let window: BrowserWindow | null = null;
  let latest: MacIndicator | null = null;

  const ensure = (): BrowserWindow | null => {
    if (window && !window.isDestroyed()) return window;
    const from = origin();
    if (!from) return null;
    window = createWindow(from, preload);
    window.webContents.once('did-finish-load', () => {
      window?.webContents.send(IPC.macControlIndicatorChanged, latest);
    });
    return window;
  };

  return {
    show(state) {
      latest = state;
      if (!state) {
        if (window && !window.isDestroyed()) window.hide();
        return;
      }
      const shown = ensure();
      if (!shown) return;
      shown.webContents.send(IPC.macControlIndicatorChanged, state);
      if (!shown.isVisible()) shown.showInactive();
    },
    owns(webContentsId) {
      return window !== null && !window.isDestroyed() && window.webContents.id === webContentsId;
    },
    dispose() {
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
}
