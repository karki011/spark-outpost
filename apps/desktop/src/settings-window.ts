import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Size,
} from 'electron';
import { attachContextMenu } from './context-menu.ts';
import { hourCycleArgs } from './hour-cycle-arg.ts';
import { systemHourCycle } from './hour-cycle.ts';
import { IPC } from './ipc-channels.ts';
import { themeArgs } from './theme-arg.ts';
import { guardNavigation } from './window.ts';

export const SETTINGS_PATH = '/settings';
const DEFAULT_SETTINGS_ROUTE = '#/settings/spark';

const SETTINGS_ROUTE = /^#\/settings\/[a-z][a-z0-9-]{0,40}(\/[a-z0-9-]{1,40})?$/;
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_LINK = /^#\/docs(\/[^\s]{1,200})?$/;
const FOCUS_LABEL_MAX = 200;
const PREFERRED = { width: 1120, height: 860 } as const;
const MINIMUM = { minWidth: 720, minHeight: 480 } as const;
const SCREEN_MARGIN = { width: 80, height: 60 } as const;

export function settingsWindowSize(workArea: Size) {
  return {
    width: Math.max(
      MINIMUM.minWidth,
      Math.min(PREFERRED.width, workArea.width - SCREEN_MARGIN.width),
    ),
    height: Math.max(
      MINIMUM.minHeight,
      Math.min(PREFERRED.height, workArea.height - SCREEN_MARGIN.height),
    ),
    ...MINIMUM,
  };
}

function workAreaFor(mainWindow: BrowserWindow | null): Size {
  const display =
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay();
  return display.workAreaSize;
}

export interface SettingsTarget {
  route: string;
  focus: string | null;
}

export function settingsTarget(route: unknown, focus: unknown): SettingsTarget | null {
  if (typeof route !== 'string' || !SETTINGS_ROUTE.test(route)) return null;
  const label = typeof focus === 'string' && focus.length <= FOCUS_LABEL_MAX ? focus : null;
  return { route, focus: label };
}

export function routeOf(url: string): string | null {
  try {
    return settingsTarget(new URL(url).hash, null)?.route ?? null;
  } catch {
    return null;
  }
}

export function isDocLink(value: unknown): value is string {
  return typeof value === 'string' && DOC_LINK.test(value);
}

export interface SettingsWindowOptions {
  origin: string;
  preload: string;
  theme: () => string | null;
  trusted: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  mainWindow: () => BrowserWindow | null;
  showSpark: () => void;
  openChat: (id: string) => void;
}

export interface SettingsWindow {
  open(target: SettingsTarget): void;
  show(): void;
  dispose(): void;
}

function createWindow(options: SettingsWindowOptions, route: string): BrowserWindow {
  const window = new BrowserWindow({
    ...settingsWindowSize(workAreaFor(options.mainWindow())),
    title: 'Settings',
    show: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [...themeArgs(options.theme()), ...hourCycleArgs(systemHourCycle())],
    },
  });
  guardNavigation(window, options.origin);
  attachContextMenu(window);
  window.once('ready-to-show', () => window.show());
  void window.loadURL(`${options.origin}${SETTINGS_PATH}${route}`);
  return window;
}

export function startSettingsWindow(options: SettingsWindowOptions): SettingsWindow {
  let window: BrowserWindow | null = null;
  let pending: SettingsTarget | null = null;
  let lastRoute = DEFAULT_SETTINGS_ROUTE;
  let pendingDoc: string | null = null;

  const focusOpen = (): boolean => {
    if (!window || window.isDestroyed()) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return true;
  };

  const create = (route: string) => {
    const created = createWindow(options, route);
    created.on('close', () => {
      lastRoute = routeOf(created.webContents.getURL()) ?? lastRoute;
    });
    created.on('closed', () => {
      if (window === created) window = null;
    });
    window = created;
  };

  const open = (target: SettingsTarget) => {
    pending = target;
    if (focusOpen()) window?.webContents.send(IPC.settingsWindowChanged);
    else create(target.route);
  };

  const show = () => {
    if (!focusOpen()) open({ route: lastRoute, focus: null });
  };

  const fromSettingsWindow = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    options.trusted(event) &&
    window !== null &&
    !window.isDestroyed() &&
    event.sender.id === window.webContents.id;

  const onOpen = (event: IpcMainEvent, route: unknown, focus: unknown) => {
    const target = settingsTarget(route, focus);
    if (options.trusted(event) && target) open(target);
  };
  const onOpenChat = (event: IpcMainEvent, id: unknown) => {
    if (fromSettingsWindow(event) && typeof id === 'string' && CHAT_ID.test(id)) {
      options.openChat(id);
    }
  };
  const fromMainWindow = (event: IpcMainInvokeEvent) => {
    const main = options.mainWindow();
    return (
      options.trusted(event) &&
      main !== null &&
      !main.isDestroyed() &&
      event.sender.id === main.webContents.id
    );
  };
  const onOpenDoc = (event: IpcMainEvent, link: unknown) => {
    if (!fromSettingsWindow(event) || !isDocLink(link)) return;
    pendingDoc = link;
    options.showSpark();
    const main = options.mainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(IPC.settingsWindowDoc);
  };

  ipcMain.on(IPC.settingsWindowOpen, onOpen);
  ipcMain.on(IPC.settingsWindowOpenChat, onOpenChat);
  ipcMain.on(IPC.settingsWindowOpenDoc, onOpenDoc);
  ipcMain.handle(IPC.settingsWindowTake, (event) => {
    if (!fromSettingsWindow(event)) return null;
    const taken = pending;
    pending = null;
    return taken;
  });
  ipcMain.handle(IPC.settingsWindowTakeDoc, (event) => {
    if (!fromMainWindow(event)) return null;
    const taken = pendingDoc;
    pendingDoc = null;
    return taken;
  });

  return {
    open,
    show,
    dispose() {
      ipcMain.off(IPC.settingsWindowOpen, onOpen);
      ipcMain.off(IPC.settingsWindowOpenChat, onOpenChat);
      ipcMain.off(IPC.settingsWindowOpenDoc, onOpenDoc);
      ipcMain.removeHandler(IPC.settingsWindowTake);
      ipcMain.removeHandler(IPC.settingsWindowTakeDoc);
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
}
