import {
  DEFAULT_SEARCH_ENGINE,
  type BrowserFavorite,
  type BrowserProfile,
  type BrowserSearchEngine,
} from '@spark-outpost/contracts';
import { ipc } from './electron-ipc.fixture.ts';
import { savedPageZooms } from './page-zoom.ts';
import { BrowserPanes } from './panes.ts';
import { BROWSER_PARTITION } from './request-guard.ts';
import type { SessionGuards } from './sessions.ts';
import { startBrowserViewHost, type BrowserViewHost } from './view-host.ts';
import type { SavedProfile, SavedTab, SavedViewStore } from './view-saved.ts';

export const sent: { channel: string; payload: unknown }[] = [];

export const panesOptions = {
  window: () => null,
  blockedPorts: () => new Set([32682]),
  stateChanged: () => undefined,
  snapshot: () => undefined,
  localOriginSeen: () => undefined,
  contextMenu: () => undefined,
  addShortcut: () => undefined,
  paneShortcut: () => undefined,
  found: () => undefined,
  log: () => undefined,
};

export function memorySaved(start: Partial<Record<BrowserProfile, SavedProfile>> = {}) {
  const profiles: Record<BrowserProfile, SavedProfile> = {
    personal: start.personal ?? { tabs: [], favorites: [], zooms: {} },
    work: start.work ?? { tabs: [], favorites: [], zooms: {} },
  };
  let engine: BrowserSearchEngine = DEFAULT_SEARCH_ENGINE;
  const store: SavedViewStore = {
    get: (profile) => profiles[profile],
    setTabs: (profile, tabs: readonly SavedTab[]) => {
      profiles[profile] = { ...profiles[profile], tabs: [...tabs] };
    },
    setFavorites: (profile, favorites: readonly BrowserFavorite[]) => {
      profiles[profile] = { ...profiles[profile], favorites: [...favorites] };
    },
    setZoom: (profile, origin, zoom) => {
      const zooms = { ...profiles[profile].zooms, [origin]: zoom };
      profiles[profile] = { ...profiles[profile], zooms };
    },
    searchEngine: () => engine,
    setSearchEngine: (next) => {
      engine = next;
    },
  };
  return { store, profiles };
}

export interface TestBrowser {
  chats: BrowserPanes;
  view: BrowserViewHost;
}

export function startTestBrowser(saved: SavedViewStore = memorySaved().store): TestBrowser {
  ipc.clear();
  sent.length = 0;
  const holder: { view: BrowserViewHost | null } = { view: null };
  const guards: SessionGuards = {
    blockedPorts: () => new Set([32682]),
    roots: (contents) => chats.rootsOfContents(contents),
    log: () => undefined,
    inputMarks: (contents) =>
      chats.inputMarks(contents) ?? holder.view?.panes.inputMarks(contents) ?? null,
  };
  const chats = new BrowserPanes({ ...panesOptions, partition: () => BROWSER_PARTITION, guards });
  const view = startBrowserViewHost({
    window: () => null,
    blockedPorts: () => new Set([32682]),
    guards,
    saved,
    zooms: (profile) => savedPageZooms(saved, profile, () => undefined),
    send: (channel, payload) => sent.push({ channel, payload }),
    guarded:
      (run) =>
      async (event, ...args) =>
        run(event, ...args),
    log: () => undefined,
  });
  holder.view = view;
  return { chats, view };
}

export function invoke(channel: string, ...args: unknown[]) {
  return ipc.get(channel)!({ sender: null }, ...args);
}
