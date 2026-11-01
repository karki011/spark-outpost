import {
  Menu,
  clipboard,
  ipcMain,
  type BrowserWindow,
  type ContextMenuParams,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import {
  BROWSER_FAVORITES_MAX,
  BROWSER_FOCUS_SHORTCUTS,
  BROWSER_VIEW_TABS_MAX,
  browserProfileSchema,
  browserSearchEngineSchema,
  browserViewCommandSchema,
  browserViewPlacementSchema,
  type BrowserCommand,
  type BrowserProfile,
  type BrowserViewCommand,
  type BrowserShortcut,
  type BrowserViewFound,
  type BrowserViewIntent,
  type BrowserViewShortcutEvent,
  type BrowserViewSnapshot,
  type BrowserViewState,
  sameFavoritePage,
} from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import { runPaneCommand } from './pane-command.ts';
import type { PageZooms } from './page-zoom.ts';
import { BrowserPanes } from './panes.ts';
import { profilePartition, type SessionGuards } from './sessions.ts';
import type { PaneTab } from './tab.ts';
import { viewMenuItems, type ViewMenuItem } from './view-menu.ts';
import { readViewPageText } from './view-page-text.ts';
import { viewHistory, type HistorySink } from './view-history.ts';
import type { SavedViewStore } from './view-saved.ts';

export interface ViewHostOptions {
  window(): BrowserWindow | null;
  blockedPorts(): ReadonlySet<number>;
  guards: SessionGuards;
  saved: SavedViewStore;
  zooms(profile: BrowserProfile): PageZooms;
  send(channel: string, payload: unknown): void;
  guarded<T>(
    run: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
  ): (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T | null>;
  log(line: string): void;
  history?: HistorySink | undefined;
}

export interface BrowserViewHost {
  panes: BrowserPanes;
  shortcut(tab: PaneTab, shortcut: BrowserShortcut): void;
  openTab(profile: BrowserProfile, url: string): Promise<boolean>;
  dispose(): void;
}

const CHANNELS = [
  IPC.browserViewState,
  IPC.browserViewPlace,
  IPC.browserViewCommand,
  IPC.browserViewStart,
  IPC.browserViewPageText,
  IPC.browserViewSearchEngine,
  IPC.browserViewSetSearchEngine,
];

function profileOf(tab: PaneTab): BrowserProfile {
  return browserProfileSchema.parse(tab.chatId);
}

export function startBrowserViewHost(options: ViewHostOptions): BrowserViewHost {
  const restored = new Set<BrowserProfile>();
  const state = (profile: BrowserProfile): BrowserViewState => ({
    profile,
    tabs: panes.tabsOf(profile).map((tab) => tab.paneTab()),
    favorites: options.saved.get(profile).favorites,
  });
  const changed = (profile: BrowserProfile) => {
    const tabs = panes.tabsOf(profile).map((tab) => ({
      url: tab.currentUrl(),
      title: tab.currentTitle(),
      pinned: tab.pinned,
      active: tab.active,
    }));
    if (restored.has(profile)) options.saved.setTabs(profile, tabs);
    options.send(IPC.browserViewStateChanged, state(profile));
  };
  const restore = (profile: BrowserProfile) => {
    if (restored.has(profile)) return;
    restored.add(profile);
    for (const saved of options.saved.get(profile).tabs) {
      const tab = panes.createTab(profile, {
        owner: 'user',
        runId: null,
        url: saved.url,
        title: saved.title,
      });
      if (!tab) break;
      tab.pinned = saved.pinned;
      if (saved.active) panes.select(profile, tab.id);
    }
  };
  const favorite = (profile: BrowserProfile, action: BrowserViewCommand) => {
    const favorites = options.saved.get(profile).favorites;
    if (action.command === 'remove_favorite') {
      options.saved.setFavorites(
        profile,
        favorites.filter((item) => item.id !== action.id),
      );
    } else if (action.command === 'add_favorite') {
      const tab = panes.tab(profile, action.tabId);
      const url = tab?.currentUrl() ?? 'about:blank';
      if (!tab || url === 'about:blank' || favorites.length >= BROWSER_FAVORITES_MAX) return;
      if (favorites.some((item) => sameFavoritePage(item.url, url))) return;
      const added = { id: randomUUID().slice(0, 8), url, title: tab.currentTitle().slice(0, 300) };
      options.saved.setFavorites(profile, [...favorites, added]);
    }
    options.send(IPC.browserViewStateChanged, state(profile));
  };
  const openFavorite = async (profile: BrowserProfile, id: string) => {
    const item = options.saved.get(profile).favorites.find((candidate) => candidate.id === id);
    if (!item) return;
    const open = panes.tabsOf(profile).find((tab) => sameFavoritePage(tab.currentUrl(), item.url));
    if (open) panes.select(profile, open.id);
    else await command(profile, { command: 'new_tab', url: item.url });
  };
  const shortcut = (tab: PaneTab, pressed: BrowserShortcut) => {
    if (BROWSER_FOCUS_SHORTCUTS.has(pressed)) options.window()?.webContents.focus();
    const event: BrowserViewShortcutEvent = { profile: profileOf(tab), shortcut: pressed };
    options.send(IPC.browserViewShortcut, event);
  };
  const command = (profile: BrowserProfile, action: BrowserCommand) =>
    runPaneCommand(panes, profile, action, { tabsMax: BROWSER_VIEW_TABS_MAX });
  const viewCommand = async (profile: BrowserProfile, raw: unknown) => {
    const action = browserViewCommandSchema.parse(raw);
    if (action.command === 'open_favorite') return openFavorite(profile, action.id);
    if (action.command === 'add_favorite' || action.command === 'remove_favorite') {
      return favorite(profile, action);
    }
    return command(profile, action);
  };
  const menuItem = (tab: PaneTab, item: ViewMenuItem): MenuItemConstructorOptions => {
    if (item.kind === 'separator') return { type: 'separator' };
    if (item.kind === 'copy') return { label: item.label, click: () => tab.contents()?.copy() };
    if (item.kind === 'copy_link') {
      return { label: item.label, click: () => clipboard.writeText(item.url) };
    }
    if (item.kind === 'selection_chat' || item.kind === 'link_chat') {
      const intent: BrowserViewIntent = {
        profile: profileOf(tab),
        tabId: tab.id,
        kind: 'new_chat',
        selection: item.kind === 'selection_chat' ? item.text : null,
        link: item.kind === 'link_chat' ? item.url : null,
      };
      return {
        label: item.label,
        click: () => {
          options.window()?.webContents.focus();
          options.send(IPC.browserViewIntent, intent);
        },
      };
    }
    const open = { command: 'new_tab', url: item.url } as const;
    return { label: item.label, click: () => void command(profileOf(tab), open) };
  };
  const contextMenu = (tab: PaneTab, params: ContextMenuParams) => {
    const items = viewMenuItems(params);
    const window = options.window();
    if (items.length === 0 || !window) return;
    Menu.buildFromTemplate(items.map((item) => menuItem(tab, item))).popup({ window });
  };

  const history = viewHistory(options.history);
  const panes: BrowserPanes = new BrowserPanes({
    window: options.window,
    blockedPorts: options.blockedPorts,
    stateChanged: (next) => changed(browserProfileSchema.parse(next.chatId)),
    snapshot: (key, image) => {
      const snapshot: BrowserViewSnapshot = { profile: browserProfileSchema.parse(key), image };
      options.send(IPC.browserViewSnapshot, snapshot);
    },
    localOriginSeen: () => undefined,
    contextMenu,
    addShortcut: () => undefined,
    paneShortcut: shortcut,
    found: (tab, active, matches) => {
      const result: BrowserViewFound = { profile: profileOf(tab), tabId: tab.id, active, matches };
      options.send(IPC.browserViewFound, result);
    },
    log: options.log,
    tabsMax: BROWSER_VIEW_TABS_MAX,
    partition: (key) => profilePartition(browserProfileSchema.parse(key)),
    guards: options.guards,
    visited: (tab, url) => history.visited(tab, url, ''),
    titled: (tab, title) => history.titled(tab, title),
    pageZooms: (key) => options.zooms(browserProfileSchema.parse(key)),
  });

  ipcMain.handle(
    IPC.browserViewState,
    options.guarded((_event, raw) => state(browserProfileSchema.parse(raw))),
  );
  ipcMain.handle(
    IPC.browserViewPlace,
    options.guarded(async (_event, raw) => {
      const placement = browserViewPlacementSchema.parse(raw);
      await panes.place({
        chatId: placement.profile,
        projectId: null,
        roots: [],
        bounds: placement.bounds,
        covered: placement.covered,
        sendsTo: 'chat',
      });
      return true;
    }),
  );
  ipcMain.handle(
    IPC.browserViewCommand,
    options.guarded(async (_event, rawProfile, action) => {
      const result = await viewCommand(browserProfileSchema.parse(rawProfile), action);
      return result ?? true;
    }),
  );
  ipcMain.handle(
    IPC.browserViewPageText,
    options.guarded((_event, rawProfile, rawTab) =>
      readViewPageText(panes, browserProfileSchema.parse(rawProfile), String(rawTab)),
    ),
  );
  ipcMain.handle(
    IPC.browserViewSearchEngine,
    options.guarded(() => options.saved.searchEngine()),
  );
  ipcMain.handle(
    IPC.browserViewSetSearchEngine,
    options.guarded((_event, raw) => {
      options.saved.setSearchEngine(browserSearchEngineSchema.parse(raw));
      return options.saved.searchEngine();
    }),
  );
  ipcMain.handle(
    IPC.browserViewStart,
    options.guarded(async (_event, raw) => {
      const profile = browserProfileSchema.parse(raw);
      restore(profile);
      if (panes.tabsOf(profile).length === 0) {
        await command(profile, { command: 'new_tab', url: null });
      }
      return state(profile);
    }),
  );

  return {
    panes,
    shortcut,
    async openTab(profile, url) {
      restore(profile);
      if (panes.tabsOf(profile).length >= BROWSER_VIEW_TABS_MAX) return false;
      await command(profile, { command: 'new_tab', url });
      return true;
    },
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      panes.dispose();
    },
  };
}
