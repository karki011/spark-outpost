import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import {
  parseViewedChat,
  parseViewedChats,
  sameChats,
  viewedChats,
  type MainWindowState,
} from './chat-viewing.ts';
import { IPC } from './ipc-channels.ts';

type SparkEvent = IpcMainEvent | IpcMainInvokeEvent;

interface ViewingHostOptions {
  trusted: (event: SparkEvent) => boolean;
  fromIsland: (event: SparkEvent) => boolean;
  onChange: (viewed: readonly string[]) => void;
}

export interface ViewingHost {
  viewed(): readonly string[];
  dispose(): void;
}

const WINDOW_EVENTS = ['focus', 'blur', 'show', 'hide', 'minimize', 'restore', 'closed'] as const;
const HIDDEN: MainWindowState = { focused: false, visible: false, minimized: false };

function windowState(window: BrowserWindow | null): MainWindowState {
  if (!window || window.isDestroyed()) return HIDDEN;
  return {
    focused: window.isFocused(),
    visible: window.isVisible(),
    minimized: window.isMinimized(),
  };
}

export function startViewingHost(options: ViewingHostOptions): ViewingHost {
  let mainWindow: BrowserWindow | null = null;
  let mainChats: readonly string[] = [];
  let islandChat: string | null = null;
  let viewed: readonly string[] = [];
  const islandPages = new WeakSet<WebContents>();

  const recompute = () => {
    const next = viewedChats({ main: windowState(mainWindow), mainChats, islandChat });
    if (sameChats(next, viewed)) return;
    viewed = next;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.viewedChanged, viewed);
    }
    options.onChange(viewed);
  };
  const settle = () => setImmediate(recompute);

  const follow = (window: BrowserWindow) => {
    if (window === mainWindow) return;
    for (const name of WINDOW_EVENTS) mainWindow?.off(name as 'focus', settle);
    mainWindow = window;
    for (const name of WINDOW_EVENTS) window.on(name as 'focus', settle);
  };

  const onReport = (event: IpcMainEvent, value: unknown) => {
    if (!options.trusted(event)) return;
    if (options.fromIsland(event)) {
      const chat = parseViewedChat(value);
      if (chat === undefined) return;
      islandChat = chat;
      if (!islandPages.has(event.sender)) {
        islandPages.add(event.sender);
        event.sender.once('destroyed', () => {
          islandChat = null;
          settle();
        });
      }
    } else {
      const chats = parseViewedChats(value);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (chats === undefined || !window) return;
      follow(window);
      mainChats = chats;
    }
    recompute();
  };

  ipcMain.on(IPC.viewingReport, onReport);
  ipcMain.handle(IPC.viewedGet, (event) => (options.trusted(event) ? viewed : []));
  app.on('browser-window-focus', settle);
  app.on('browser-window-blur', settle);
  app.on('did-become-active', settle);

  return {
    viewed: () => viewed,
    dispose: () => {
      ipcMain.off(IPC.viewingReport, onReport);
      ipcMain.removeHandler(IPC.viewedGet);
      app.off('browser-window-focus', settle);
      app.off('browser-window-blur', settle);
      app.off('did-become-active', settle);
      for (const name of WINDOW_EVENTS) mainWindow?.off(name as 'focus', settle);
    },
  };
}
