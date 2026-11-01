import {
  DEFAULT_BROWSER_ARCHIVE,
  DEFAULT_SEARCH_ENGINE,
  type BrowserArchiveSetting,
  type BrowserFavorite,
  type BrowserProfile,
  type BrowserSearchEngine,
} from '@spark-outpost/contracts';
import { ipc } from './electron-ipc.fixture.ts';
import { savedPageZooms } from './page-zoom.ts';
import { BrowserPanes } from './panes.ts';
import { BROWSER_PARTITION } from './request-guard.ts';
import type { SessionGuards } from './sessions.ts';
import { startBrowserViewHost, type BrowserViewHost, type ViewHostOptions } from './view-host.ts';
import {
  emptySavedView,
  type SavedProfile,
  type SavedTab,
  type SavedViewStore,
} from './view-saved.ts';

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

export function memorySaved(
  start: Partial<
    Record<BrowserProfile, Pick<SavedProfile, 'tabs' | 'favorites'> & Partial<SavedProfile>>
  > = {},
) {
  const empty = emptySavedView();
  const profiles: Record<BrowserProfile, SavedProfile> = {
    personal: { ...empty.profiles.personal, ...start.personal },
    work: { ...empty.profiles.work, ...start.work },
  };
  let engine: BrowserSearchEngine = DEFAULT_SEARCH_ENGINE;
  let archive: BrowserArchiveSetting = DEFAULT_BROWSER_ARCHIVE;
  const store: SavedViewStore = {
    get: (profile) => profiles[profile],
    setTabs: (profile, tabs: readonly SavedTab[]) => {
      profiles[profile] = { ...profiles[profile], tabs: [...tabs] };
    },
    setFavorites: (profile, favorites: readonly BrowserFavorite[]) => {
      profiles[profile] = { ...profiles[profile], favorites: [...favorites] };
    },
    clearZooms: (profile) => {
      profiles[profile] = { ...profiles[profile], zooms: {} };
    },
    setZoom: (profile, origin, zoom) => {
      const zooms = { ...profiles[profile].zooms, [origin]: zoom };
      profiles[profile] = { ...profiles[profile], zooms };
    },
    setLayout: (profile, layout) => {
      profiles[profile] = { ...profiles[profile], ...layout };
    },
    searchEngine: () => engine,
    setSearchEngine: (next) => {
      engine = next;
    },
    archive: () => archive,
    setArchive: (next) => {
      archive = next;
    },
  };
  return { store, profiles };
}

export interface TestBrowser {
  chats: BrowserPanes;
  view: BrowserViewHost;
}

export function startTestBrowser(
  saved: SavedViewStore = memorySaved().store,
  clock: Pick<ViewHostOptions, 'now' | 'sweepEvery'> = {},
): TestBrowser {
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
    ...clock,
  });
  holder.view = view;
  return { chats, view };
}

export function invoke(channel: string, ...args: unknown[]) {
  return ipc.get(channel)!({ sender: null }, ...args);
}
