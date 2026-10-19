import {
  Menu,
  ipcMain,
  type BrowserWindow,
  type ContextMenuParams,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  addressToUrl,
  browserCommandSchema,
  browserIdSchema,
  browserSignOutSchema,
  browserPlacementSchema,
  type BrowserCommand,
  type BrowserPick,
  type BrowserSelectedText,
} from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import { runBrowserOp } from './agent-ops.ts';
import { connectWorkerBridge, type BridgePort, type WorkerBridge } from './bridge.ts';
import { BrowserPanes } from './panes.ts';
import { startPick, type PickSession } from './picker.ts';
import { loadRecentOrigins } from './recent-origins.ts';
import {
  readPageSelection,
  selectedPageText,
  selectionMenuItems,
  type SelectionIntent,
  type SelectionMenuItem,
} from './selection-menu.ts';
import { signOut, signedInSites } from './sessions.ts';
import type { PaneTab } from './tab.ts';

export interface BrowserHostOptions {
  window(): BrowserWindow | null;
  trusted(event: IpcMainInvokeEvent): boolean;
  userData: string;
  blockedPorts: readonly number[];
  log(line: string): void;
}

export interface DesktopBrowserHost {
  connectWorker(port: BridgePort): WorkerBridge;
  windowClosed(): void;
  dispose(): void;
}

const CHANNELS = [
  IPC.browserState,
  IPC.browserPlace,
  IPC.browserCommand,
  IPC.browserStart,
  IPC.browserSites,
  IPC.browserSignOut,
];

function menuTemplate(
  items: readonly SelectionMenuItem[],
  sendText: (intent: SelectionIntent) => void,
  copy: () => void,
): MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.kind === 'separator') return { type: 'separator' };
    if (item.kind === 'copy') return { label: item.label, click: copy };
    return { label: item.label, click: () => sendText(item.intent) };
  });
}

export async function startBrowserHost(options: BrowserHostOptions): Promise<DesktopBrowserHost> {
  const blocked = new Set<number>(options.blockedPorts);
  const origins = await loadRecentOrigins(options.userData, options.log);
  const picks = new Map<string, PickSession>();
  const send = (channel: string, payload: unknown) => {
    const window = options.window();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const panes = new BrowserPanes({
    window: options.window,
    blockedPorts: () => blocked,
    stateChanged: (state) => send(IPC.browserStateChanged, state),
    snapshot: (chatId, image) => send(IPC.browserSnapshot, { chatId, image }),
    localOriginSeen: (projectId, origin) => origins.note(projectId, origin),
    contextMenu: (tab, params) => showSelectionMenu(tab, params),
    addShortcut: (tab) => void addSelection(tab),
    log: options.log,
  });

  const sendSelection = (tab: PaneTab, raw: string, intent: SelectionIntent) => {
    const text = selectedPageText(raw);
    if (!text) return;
    const selected: BrowserSelectedText = {
      chatId: tab.chatId,
      url: tab.currentUrl().slice(0, 4096),
      title: tab.currentTitle().slice(0, 300),
      text,
      intent,
    };
    send(IPC.browserSelectedText, selected);
    options.window()?.webContents.focus();
  };

  const showSelectionMenu = (tab: PaneTab, params: ContextMenuParams) => {
    const items = selectionMenuItems(params, tab.picking, panes.sendsTo(tab.chatId));
    const window = options.window();
    if (items.length === 0 || !window) return;
    const template = menuTemplate(
      items,
      (intent) => sendSelection(tab, params.selectionText, intent),
      () => tab.view()?.webContents.copy(),
    );
    Menu.buildFromTemplate(template).popup({ window });
  };

  const addSelection = async (tab: PaneTab) => {
    if (tab.picking) return;
    try {
      const { cdp } = await tab.ensure();
      sendSelection(tab, await readPageSelection(cdp), 'add');
    } catch (error) {
      options.log(`Could not read the page selection: ${(error as Error).message}`);
    }
  };

  const stopPick = async (tab: PaneTab) => {
    const session = picks.get(tab.id);
    picks.delete(tab.id);
    tab.picking = false;
    await session?.cancel();
    panes.noteChange(tab.chatId);
  };

  const pick = async (tab: PaneTab, mode: 'element' | 'region' | 'off') => {
    await stopPick(tab);
    if (mode === 'off') return;
    const { cdp, view } = await tab.wake();
    tab.picking = true;
    panes.noteChange(tab.chatId);
    view.webContents.focus();
    const session = await startPick(
      cdp,
      mode,
      (picked) => {
        picks.delete(tab.id);
        tab.picking = false;
        panes.noteChange(tab.chatId);
        if (!picked) return;
        const result: BrowserPick = {
          chatId: tab.chatId,
          url: tab.currentUrl().slice(0, 4096),
          title: tab.currentTitle().slice(0, 300),
          ...picked,
        };
        send(IPC.browserPicked, result);
        options.window()?.webContents.focus();
      },
      tab.filled,
    );
    picks.set(tab.id, session);
  };

  const navigate = async (chatId: string, tab: PaneTab, typed: string) => {
    const url = addressToUrl(typed);
    if (!url) return;
    if (!tab.handoff) {
      tab.owner = 'user';
      tab.runId = null;
    }
    tab.lastAction = null;
    await tab.load(url);
    panes.noteChange(chatId);
    panes.layout();
  };

  const command = async (chatId: string, action: BrowserCommand) => {
    if (action.command === 'new_tab') {
      const url = action.url ? addressToUrl(action.url) : null;
      const tab = panes.createTab(chatId, {
        owner: 'user',
        runId: null,
        url: url ?? 'about:blank',
      });
      if (!tab) return;
      panes.select(chatId, tab.id);
      if (url) await navigate(chatId, tab, url);
      return;
    }
    const tab = panes.tab(chatId, action.tabId);
    if (!tab) return;
    if (action.command === 'navigate') await navigate(chatId, tab, action.url);
    else if (action.command === 'select') panes.select(chatId, tab.id);
    else if (action.command === 'close') {
      await stopPick(tab);
      panes.close(chatId, tab.id);
    } else if (action.command === 'pin') {
      tab.pinned = action.pinned;
      panes.noteChange(chatId);
    } else if (action.command === 'devtools') {
      tab.openDevtools();
    } else if (action.command === 'pick') {
      tab.keep();
      await pick(tab, action.mode);
    } else {
      tab.keep();
      tab.history(action.command);
    }
  };

  const guarded =
    <T>(run: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T) =>
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!options.trusted(event)) return null;
      try {
        return await run(event, ...args);
      } catch (error) {
        options.log(`A browser pane request failed: ${(error as Error).message}`);
        return null;
      }
    };

  ipcMain.handle(
    IPC.browserState,
    guarded((_event, chatId) => panes.state(browserIdSchema.parse(chatId))),
  );
  ipcMain.handle(
    IPC.browserPlace,
    guarded(async (_event, placement) => {
      await panes.place(browserPlacementSchema.parse(placement));
      return true;
    }),
  );
  ipcMain.handle(
    IPC.browserCommand,
    guarded(async (_event, chatId, action) => {
      await command(browserIdSchema.parse(chatId), browserCommandSchema.parse(action));
      return true;
    }),
  );
  ipcMain.handle(
    IPC.browserStart,
    guarded(async (_event, raw) => {
      const placement = browserPlacementSchema.parse(raw);
      panes.touch(placement.chatId, placement, placement.sendsTo);
      if (panes.tabsOf(placement.chatId).length > 0) return panes.state(placement.chatId);
      const recent = placement.projectId ? origins.get(placement.projectId) : null;
      await command(placement.chatId, { command: 'new_tab', url: recent });
      return panes.state(placement.chatId);
    }),
  );
  ipcMain.handle(
    IPC.browserSites,
    guarded((_event, projectId) => signedInSites(browserIdSchema.parse(projectId))),
  );
  ipcMain.handle(
    IPC.browserSignOut,
    guarded(async (_event, raw) => {
      const { projectId, origin } = browserSignOutSchema.parse(raw);
      await signOut(projectId, origin);
      return signedInSites(projectId);
    }),
  );

  return {
    connectWorker(port) {
      return connectWorkerBridge(port, {
        run: (request, signal) => runBrowserOp(panes, request, signal),
        ports: (ports) => {
          for (const port of ports) blocked.add(port);
        },
      });
    },
    windowClosed: () => panes.sleepAll(),
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      try {
        panes.dispose();
      } catch (error) {
        options.log(`Could not close the browser pane cleanly: ${(error as Error).message}`);
      }
    },
  };
}
