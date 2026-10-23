import {
  Menu,
  ipcMain,
  webContents,
  type BrowserWindow,
  type ContextMenuParams,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  BROWSER_FOCUS_SHORTCUTS,
  BROWSER_TABS_MAX,
  browserCommandSchema,
  browserIdSchema,
  browserSignOutSchema,
  browserPlacementSchema,
  type BrowserCommand,
  type BrowserPick,
  type BrowserFound,
  type BrowserSelectedText,
  type BrowserShortcut,
  type BrowserShortcutEvent,
} from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import { runBrowserOp } from './agent-ops.ts';
import { connectWorkerBridge, type BridgePort, type WorkerBridge } from './bridge.ts';
import { runPaneCommand } from './pane-command.ts';
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
import { removeRetiredPartitions } from './retired-partitions.ts';
import { BROWSER_PARTITION } from './request-guard.ts';
import { signOut, signedInSites, type SessionGuards } from './sessions.ts';
import { startBrowserViewHost, type BrowserViewHost } from './view-host.ts';
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
  menuShortcut(shortcut: BrowserShortcut): boolean;
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
  await removeRetiredPartitions(options.userData, options.log);
  const origins = await loadRecentOrigins(options.userData, options.log);
  const picks = new Map<string, PickSession>();
  const send = (channel: string, payload: unknown) => {
    const window = options.window();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const paneShortcut = (tab: PaneTab, shortcut: BrowserShortcut) => {
    if (BROWSER_FOCUS_SHORTCUTS.has(shortcut)) options.window()?.webContents.focus();
    const event: BrowserShortcutEvent = { chatId: tab.chatId, shortcut };
    send(IPC.browserShortcut, event);
  };
  let view: BrowserViewHost | null = null;
  const guards: SessionGuards = {
    blockedPorts: () => blocked,
    roots: (contents) => panes.rootsOfContents(contents),
    log: options.log,
    inputMarks: (contents) =>
      panes.inputMarks(contents) ?? view?.panes.inputMarks(contents) ?? null,
  };
  const panes: BrowserPanes = new BrowserPanes({
    window: options.window,
    partition: () => BROWSER_PARTITION,
    guards,
    blockedPorts: () => blocked,
    stateChanged: (state) => send(IPC.browserStateChanged, state),
    snapshot: (chatId, image) => send(IPC.browserSnapshot, { chatId, image }),
    localOriginSeen: (projectId, origin) => origins.note(projectId, origin),
    contextMenu: (tab, params) => showSelectionMenu(tab, params),
    addShortcut: (tab) => void addSelection(tab),
    paneShortcut,
    found: (tab, active, matches) => {
      const result: BrowserFound = { chatId: tab.chatId, tabId: tab.id, active, matches };
      send(IPC.browserFound, result);
    },
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
      () => tab.contents()?.copy(),
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

  const command = (chatId: string, action: BrowserCommand) =>
    runPaneCommand(panes, chatId, action, {
      tabsMax: BROWSER_TABS_MAX,
      pick,
      closed: (tab) => void stopPick(tab).catch(() => undefined),
    });

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

  const viewHost = startBrowserViewHost({
    window: options.window,
    blockedPorts: () => blocked,
    guards,
    send,
    guarded,
    log: options.log,
  });
  view = viewHost;

  ipcMain.on(IPC.browserPageCopyAllowed, (event) => {
    event.returnValue =
      panes.pageCopyAllowed(event.sender) || viewHost.panes.pageCopyAllowed(event.sender);
  });
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
      const result = await command(
        browserIdSchema.parse(chatId),
        browserCommandSchema.parse(action),
      );
      return result ?? true;
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
    guarded(() => signedInSites()),
  );
  ipcMain.handle(
    IPC.browserSignOut,
    guarded(async (_event, raw) => {
      const { origin } = browserSignOutSchema.parse(raw);
      await signOut(origin);
      return signedInSites();
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
    windowClosed: () => {
      panes.sleepAll();
      viewHost.panes.sleepAll();
    },
    menuShortcut(shortcut) {
      const focused = webContents.getFocusedWebContents();
      const tab = panes.tabOfContents(focused);
      if (tab) {
        paneShortcut(tab, shortcut);
        return true;
      }
      const viewTab = viewHost.panes.tabOfContents(focused);
      if (!viewTab) return false;
      viewHost.shortcut(viewTab, shortcut);
      return true;
    },
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      ipcMain.removeAllListeners(IPC.browserPageCopyAllowed);
      try {
        viewHost.dispose();
        panes.dispose();
      } catch (error) {
        options.log(`Could not close the browser pane cleanly: ${(error as Error).message}`);
      }
    },
  };
}
