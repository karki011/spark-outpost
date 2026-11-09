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
  browserArchiveSettingSchema,
  browserLinksInSchema,
  browserViewOpenTabSchema,
  browserProfileSchema,
  browserSearchEngineSchema,
  browserSpaceKey,
  browserViewCommandSchema,
  browserViewPlacementSchema,
  browserViewSlotSchema,
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
  splitHolds,
} from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import { runPaneCommand } from './pane-command.ts';
import { pickRunner } from './pick-runner.ts';
import type { PageZooms } from './page-zoom.ts';
import { BrowserPanes } from './panes.ts';
import { profilePartition, type SessionGuards } from './sessions.ts';
import { chordOf } from './tab-keys.ts';
import type { PaneTab } from './tab.ts';
import { isArrangeCommand, startViewArrange } from './view-arrange.ts';
import { viewMenuItems, type ViewMenuItem } from './view-menu.ts';
import { readViewPageText } from './view-page-text.ts';
import { viewHistory, type HistorySink } from './view-history.ts';
import { applyLayoutCommand, isLayoutCommand } from './view-layout.ts';
import type { SavedTab, SavedViewStore } from './view-saved.ts';
import { ViewSpaces } from './view-spaces.ts';

const SWEEP_MS = 60_000;

function everyMinute(run: () => void): () => void {
  const timer = setInterval(run, SWEEP_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export interface ViewHostOptions {
  window(): BrowserWindow | null;
  blockedPorts(): ReadonlySet<number>;
  guards: SessionGuards;
  saved: SavedViewStore;
  zooms(profile: BrowserProfile): PageZooms;
  zoomsCleared?(): void;
  send(channel: string, payload: unknown): void;
  guarded<T>(
    run: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
  ): (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T | null>;
  log(line: string): void;
  history?: HistorySink | undefined;
  now?: () => number;
  sweepEvery?: (run: () => void) => () => void;
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
  IPC.browserViewPlaceSlot,
  IPC.browserViewCommand,
  IPC.browserViewStart,
  IPC.browserViewPageText,
  IPC.browserViewSearchEngine,
  IPC.browserViewSetSearchEngine,
  IPC.browserViewClearZooms,
  IPC.browserViewArchive,
  IPC.browserViewSetArchive,
  IPC.browserViewLinksIn,
  IPC.browserViewSetLinksIn,
  IPC.browserViewOpenTab,
];

function profileOf(tab: PaneTab): BrowserProfile {
  return browserProfileSchema.parse(tab.chatId);
}

export function startBrowserViewHost(options: ViewHostOptions): BrowserViewHost {
  const restored = new Set<BrowserProfile>();
  const spaces = new ViewSpaces(
    () => panes,
    options.saved,
    options.now ?? Date.now,
    (profile, tabId) => splitHolds(arrange.state(profile).split, tabId),
  );
  const arrange = startViewArrange({
    panes: () => panes,
    snapshot: (profile, tabId, image) => {
      const snapshot: BrowserViewSnapshot = { profile, image, tabId };
      options.send(IPC.browserViewSnapshot, snapshot);
    },
    log: options.log,
  });
  const listed = (profile: BrowserProfile) => panes.tabsOf(profile).filter((tab) => !tab.peek);
  const state = (profile: BrowserProfile): BrowserViewState => ({
    profile,
    tabs: listed(profile).map((tab) => tab.paneTab()),
    favorites: options.saved.get(profile).favorites,
    layout: spaces.snapshot(profile),
    ...arrange.state(profile),
  });
  const changed = (profile: BrowserProfile) => {
    arrange.settle(profile);
    if (spaces.settle(profile)) return;
    if (restored.has(profile)) {
      const tabs = listed(profile).map((tab) => ({
        ...spaces.savedTab(profile, tab),
        split: arrange.mark(profile, tab.id),
      }));
      options.saved.setTabs(profile, tabs);
      spaces.persist(profile);
    }
    options.send(IPC.browserViewStateChanged, state(profile));
  };
  const restore = (profile: BrowserProfile) => {
    if (restored.has(profile)) return;
    restored.add(profile);
    const made: { id: string; split: SavedTab['split'] }[] = [];
    for (const saved of spaces.restoredTabs(profile)) {
      const tab = panes.createTab(profile, {
        owner: 'user',
        runId: null,
        url: saved.url,
        title: saved.title,
      });
      if (!tab) break;
      tab.pinned = saved.pinned;
      spaces.adopt(profile, tab, saved);
      if (saved.active) panes.select(profile, tab.id);
      made.push({ id: tab.id, split: saved.split });
    }
    arrange.restore(profile, made);
    changed(profile);
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
    const open = listed(profile).find((tab) => sameFavoritePage(tab.currentUrl(), item.url));
    if (open) {
      spaces.followTab(profile, open.id);
      panes.select(profile, open.id);
    } else await command(profile, { command: 'new_tab', url: item.url });
  };
  const shortcut = (tab: PaneTab, pressed: BrowserShortcut) => {
    if (BROWSER_FOCUS_SHORTCUTS.has(pressed)) options.window()?.webContents.focus();
    const event: BrowserViewShortcutEvent = { profile: profileOf(tab), shortcut: pressed };
    options.send(IPC.browserViewShortcut, event);
  };
  const picker = pickRunner({
    panes: () => panes,
    window: options.window,
    picked: (pick) => options.send(IPC.browserViewPicked, pick),
    keepsImage: (tab) => profileOf(tab) !== 'personal',
  });
  const command = (profile: BrowserProfile, action: BrowserCommand) =>
    runPaneCommand(panes, profile, action, {
      tabsMax: BROWSER_VIEW_TABS_MAX,
      pick: picker.pick,
      closed: (tab) => void picker.stop(tab).catch(() => undefined),
    });
  const viewCommand = async (profile: BrowserProfile, raw: unknown) => {
    const action = browserViewCommandSchema.parse(raw);
    restore(profile);
    spaces.settle(profile);
    const result = await runViewCommand(profile, action);
    spaces.settle(profile);
    return result;
  };
  const runViewCommand = async (profile: BrowserProfile, action: BrowserViewCommand) => {
    if (isArrangeCommand(action)) return arrange.command(profile, action);
    if (action.command === 'select' && arrange.isPeek(profile, action.tabId)) return;
    if (isLayoutCommand(action)) {
      panes.keepFocus(profile, () => {
        if (
          action.command === 'tab_to_space' &&
          splitHolds(arrange.state(profile).split, action.tabId)
        ) {
          arrange.command(profile, { command: 'split_leave' });
        }
        applyLayoutCommand(spaces.layout(profile), action);
        changed(profile);
      });
      return;
    }
    if (action.command === 'pinned_home') {
      const pinnedUrl = spaces.layout(profile).metas.get(action.tabId)?.pinnedUrl;
      if (pinnedUrl)
        await command(profile, { command: 'navigate', tabId: action.tabId, url: pinnedUrl });
      return;
    }
    if (action.command === 'archived_open') {
      if (panes.tabsOf(profile).length >= BROWSER_VIEW_TABS_MAX) return;
      const url = spaces.takeArchived(profile, action.id);
      if (url) await command(profile, { command: 'new_tab', url });
      return;
    }
    if (action.command === 'select') spaces.followTab(profile, action.tabId);
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
    if (item.kind === 'peek_link' || item.kind === 'split_link') {
      const gesture = item.kind === 'peek_link' ? 'peek' : 'split';
      return { label: item.label, click: () => void arrange.openLink(tab, item.url, gesture) };
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
    pageKey: (tab, input) => {
      if (arrange.pageKey(tab, input)) return true;
      if (input.type !== 'keyDown') return false;
      const index = browserSpaceKey(chordOf(input), process.platform === 'darwin');
      if (index === null) return false;
      const profile = profileOf(tab);
      const space = spaces.layout(profile).spaces[index];
      if (space) void viewCommand(profile, { command: 'space_switch', id: space.id });
      return true;
    },
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
    shiftedLink: (opener, url) => arrange.shiftedLink(opener, url),
    slotBounds: (tab) => arrange.slotBounds(tab),
    tabUsed: (tab) => arrange.tabUsed(tab),
  });

  ipcMain.handle(
    IPC.browserViewState,
    options.guarded((_event, raw) => state(browserProfileSchema.parse(raw))),
  );
  ipcMain.handle(
    IPC.browserViewPlace,
    options.guarded(async (_event, raw) => {
      const placement = browserViewPlacementSchema.parse(raw);
      arrange.watchChrome(options.window()?.webContents ?? null);
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
    IPC.browserViewPlaceSlot,
    options.guarded(async (_event, raw) => {
      await arrange.placeSlot(browserViewSlotSchema.parse(raw));
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
    IPC.browserViewClearZooms,
    options.guarded((_event, raw) => {
      options.saved.clearZooms(browserProfileSchema.parse(raw));
      options.zoomsCleared?.();
      panes.syncZooms();
      return true;
    }),
  );
  ipcMain.handle(
    IPC.browserViewArchive,
    options.guarded(() => options.saved.archive()),
  );
  ipcMain.handle(
    IPC.browserViewSetArchive,
    options.guarded((_event, raw) => {
      options.saved.setArchive(browserArchiveSettingSchema.parse(raw));
      return options.saved.archive();
    }),
  );
  ipcMain.handle(
    IPC.browserViewLinksIn,
    options.guarded(() => options.saved.linksIn()),
  );
  ipcMain.handle(
    IPC.browserViewSetLinksIn,
    options.guarded((_event, raw) => {
      options.saved.setLinksIn(browserLinksInSchema.parse(raw));
      return options.saved.linksIn();
    }),
  );
  ipcMain.handle(
    IPC.browserViewOpenTab,
    options.guarded((_event, profile, url) => {
      const request = browserViewOpenTabSchema.parse({ profile, url });
      return openTab(request.profile, request.url);
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

  const sweepAll = () => {
    for (const profile of restored) {
      spaces.sweep(profile);
      changed(profile);
    }
  };
  const stopSweeping = (options.sweepEvery ?? everyMinute)(sweepAll);

  async function openTab(profile: BrowserProfile, url: string): Promise<boolean> {
    restore(profile);
    if (panes.tabsOf(profile).length >= BROWSER_VIEW_TABS_MAX) return false;
    await command(profile, { command: 'new_tab', url });
    return true;
  }

  return {
    panes,
    shortcut,
    openTab,
    dispose() {
      stopSweeping();
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      panes.dispose();
    },
  };
}
