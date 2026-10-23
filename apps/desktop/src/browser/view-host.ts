import {
  Menu,
  clipboard,
  ipcMain,
  type BrowserWindow,
  type ContextMenuParams,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  BROWSER_FOCUS_SHORTCUTS,
  BROWSER_VIEW_TABS_MAX,
  browserCommandSchema,
  browserProfileSchema,
  browserViewPlacementSchema,
  type BrowserProfile,
  type BrowserShortcut,
  type BrowserViewFound,
  type BrowserViewShortcutEvent,
  type BrowserViewSnapshot,
  type BrowserViewState,
} from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import { runPaneCommand } from './pane-command.ts';
import { BrowserPanes } from './panes.ts';
import { profilePartition, type SessionGuards } from './sessions.ts';
import type { PaneTab } from './tab.ts';
import { viewMenuItems, type ViewMenuItem } from './view-menu.ts';

export interface ViewHostOptions {
  window(): BrowserWindow | null;
  blockedPorts(): ReadonlySet<number>;
  guards: SessionGuards;
  send(channel: string, payload: unknown): void;
  guarded<T>(
    run: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
  ): (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T | null>;
  log(line: string): void;
}

export interface BrowserViewHost {
  panes: BrowserPanes;
  shortcut(tab: PaneTab, shortcut: BrowserShortcut): void;
  dispose(): void;
}

const CHANNELS = [
  IPC.browserViewState,
  IPC.browserViewPlace,
  IPC.browserViewCommand,
  IPC.browserViewStart,
];

function profileOf(tab: PaneTab): BrowserProfile {
  return browserProfileSchema.parse(tab.chatId);
}

export function startBrowserViewHost(options: ViewHostOptions): BrowserViewHost {
  const state = (profile: BrowserProfile): BrowserViewState => ({
    profile,
    tabs: panes.tabsOf(profile).map((tab) => tab.paneTab()),
  });
  const shortcut = (tab: PaneTab, pressed: BrowserShortcut) => {
    if (BROWSER_FOCUS_SHORTCUTS.has(pressed)) options.window()?.webContents.focus();
    const event: BrowserViewShortcutEvent = { profile: profileOf(tab), shortcut: pressed };
    options.send(IPC.browserViewShortcut, event);
  };
  const command = (profile: BrowserProfile, raw: unknown) =>
    runPaneCommand(panes, profile, browserCommandSchema.parse(raw), {
      tabsMax: BROWSER_VIEW_TABS_MAX,
    });
  const menuItem = (tab: PaneTab, item: ViewMenuItem): MenuItemConstructorOptions => {
    if (item.kind === 'separator') return { type: 'separator' };
    if (item.kind === 'copy') return { label: item.label, click: () => tab.contents()?.copy() };
    if (item.kind === 'copy_link') {
      return { label: item.label, click: () => clipboard.writeText(item.url) };
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

  const panes: BrowserPanes = new BrowserPanes({
    window: options.window,
    blockedPorts: options.blockedPorts,
    stateChanged: (changed) => {
      const profile = browserProfileSchema.parse(changed.chatId);
      options.send(IPC.browserViewStateChanged, state(profile));
    },
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
      const result = await command(browserProfileSchema.parse(rawProfile), action);
      return result ?? true;
    }),
  );
  ipcMain.handle(
    IPC.browserViewStart,
    options.guarded(async (_event, raw) => {
      const profile = browserProfileSchema.parse(raw);
      if (panes.tabsOf(profile).length === 0) {
        await command(profile, { command: 'new_tab', url: null });
      }
      return state(profile);
    }),
  );

  return {
    panes,
    shortcut,
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      panes.dispose();
    },
  };
}
