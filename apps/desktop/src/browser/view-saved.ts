import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  BROWSER_ARCHIVED_MAX,
  BROWSER_FAVORITES_MAX,
  BROWSER_SPACES_MAX,
  BROWSER_TAB_FOLDERS_MAX,
  BROWSER_URL_MAX,
  BROWSER_VIEW_TABS_MAX,
  DEFAULT_BROWSER_ARCHIVE,
  DEFAULT_LINKS_IN,
  DEFAULT_SEARCH_ENGINE,
  browserArchiveSettingSchema,
  browserArchivedTabSchema,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  browserFavoriteSchema,
  browserLinksInSchema,
  browserOrigin,
  browserSearchEngineSchema,
  browserZoomSchema,
  browserSpaceSchema,
  browserTabFolderSchema,
  classifyBrowserUrl,
  type BrowserArchiveSetting,
  type BrowserFavorite,
  type BrowserLinksIn,
  type BrowserProfile,
  type BrowserSearchEngine,
  type BrowserSpace,
} from '@spark-outpost/contracts';

const FILE_NAME = 'browser-view.json';
const ZOOMS_MAX = 500;

function entriesOf<T extends z.ZodType>(entry: T, max: number) {
  return z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((items) =>
      items
        .flatMap((item): z.output<T>[] => {
          const parsed = entry.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, max),
    );
}

const savedIdSchema = z.string().min(1).max(40);

const savedTabSchema = z.object({
  url: z.string().min(1).max(BROWSER_URL_MAX),
  title: z.string().max(300),
  pinned: z.boolean(),
  active: z.boolean(),
  spaceId: savedIdSchema.optional().catch(undefined),
  folderId: savedIdSchema.nullable().optional().catch(undefined),
  pinnedUrl: z.string().min(1).max(BROWSER_URL_MAX).nullable().optional().catch(undefined),
  shownAt: z.number().int().min(0).optional().catch(undefined),
  split: z
    .object({
      side: z.enum(['left', 'right']),
      ratio: z.number().min(SPLIT_RATIO_MIN).max(SPLIT_RATIO_MAX),
    })
    .optional()
    .catch(undefined),
});
export type SavedTab = z.infer<typeof savedTabSchema>;

const savedProfileSchema = z.object({
  tabs: entriesOf(savedTabSchema, BROWSER_VIEW_TABS_MAX),
  favorites: entriesOf(browserFavoriteSchema, BROWSER_FAVORITES_MAX),
  spaces: entriesOf(browserSpaceSchema, BROWSER_SPACES_MAX),
  currentSpaceId: z.string().max(40).catch('').default(''),
  folders: entriesOf(browserTabFolderSchema, BROWSER_TAB_FOLDERS_MAX),
  archived: entriesOf(browserArchivedTabSchema, BROWSER_ARCHIVED_MAX),
  zooms: z.record(z.string().max(300), browserZoomSchema).catch({}).default({}),
});
export type SavedProfile = z.infer<typeof savedProfileSchema>;

const savedViewSchema = z.object({
  version: z.literal(1),
  profiles: z.object({ personal: savedProfileSchema, work: savedProfileSchema }),
  searchEngine: browserSearchEngineSchema
    .catch(DEFAULT_SEARCH_ENGINE)
    .default(DEFAULT_SEARCH_ENGINE),
  archive: browserArchiveSettingSchema
    .catch(DEFAULT_BROWSER_ARCHIVE)
    .default(DEFAULT_BROWSER_ARCHIVE),
  linksIn: browserLinksInSchema.catch(DEFAULT_LINKS_IN).default(DEFAULT_LINKS_IN),
});
export type SavedView = z.infer<typeof savedViewSchema>;

export const DEFAULT_SPACE: BrowserSpace = {
  id: 'main',
  name: 'Main',
  icon: 'home',
  color: 'accent',
};

const EMPTY_PROFILE: SavedProfile = {
  tabs: [],
  favorites: [],
  spaces: [DEFAULT_SPACE],
  currentSpaceId: DEFAULT_SPACE.id,
  folders: [],
  archived: [],
  zooms: {},
};

export function emptySavedView(): SavedView {
  return {
    version: 1,
    profiles: { personal: EMPTY_PROFILE, work: EMPTY_PROFILE },
    searchEngine: DEFAULT_SEARCH_ENGINE,
    archive: DEFAULT_BROWSER_ARCHIVE,
    linksIn: DEFAULT_LINKS_IN,
  };
}

function webAddress(url: string): boolean {
  const kind = classifyBrowserUrl(url);
  return kind === 'local' || kind === 'external';
}

function keptZooms(zooms: Record<string, number>): Record<string, number> {
  const kept = Object.entries(zooms).filter(([origin]) => browserOrigin(origin) === origin);
  return Object.fromEntries(kept.slice(-ZOOMS_MAX));
}

function uniqueIds<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function cleanPinnedUrl(tab: SavedTab): SavedTab {
  return tab.pinnedUrl && !webAddress(tab.pinnedUrl) ? { ...tab, pinnedUrl: null } : tab;
}

export function parseSavedView(text: string): SavedView {
  try {
    const parsed = savedViewSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return emptySavedView();
    const clean = (profile: SavedProfile): SavedProfile => {
      const spaces = uniqueIds(profile.spaces);
      const known = spaces.length > 0 ? spaces : [DEFAULT_SPACE];
      const currentKnown = known.some((space) => space.id === profile.currentSpaceId);
      return {
        tabs: profile.tabs.filter((tab) => webAddress(tab.url)).map(cleanPinnedUrl),
        favorites: profile.favorites.filter((favorite) => webAddress(favorite.url)),
        spaces: known,
        currentSpaceId: currentKnown ? profile.currentSpaceId : known[0]!.id,
        folders: uniqueIds(profile.folders).filter((folder) =>
          known.some((space) => space.id === folder.spaceId),
        ),
        archived: uniqueIds(profile.archived).filter((tab) => webAddress(tab.url)),
        zooms: keptZooms(profile.zooms),
      };
    };
    return {
      version: 1,
      profiles: {
        personal: clean(parsed.data.profiles.personal),
        work: clean(parsed.data.profiles.work),
      },
      searchEngine: parsed.data.searchEngine,
      archive: parsed.data.archive,
      linksIn: parsed.data.linksIn,
    };
  } catch {
    return emptySavedView();
  }
}

export function keptTabs(tabs: readonly SavedTab[]): SavedTab[] {
  return tabs.filter((tab) => webAddress(tab.url)).slice(0, BROWSER_VIEW_TABS_MAX);
}

export type SavedLayout = Pick<SavedProfile, 'spaces' | 'currentSpaceId' | 'folders' | 'archived'>;

export interface SavedViewStore {
  get(profile: BrowserProfile): SavedProfile;
  setTabs(profile: BrowserProfile, tabs: readonly SavedTab[]): void;
  setFavorites(profile: BrowserProfile, favorites: readonly BrowserFavorite[]): void;
  setLayout(profile: BrowserProfile, layout: SavedLayout): void;
  searchEngine(): BrowserSearchEngine;
  setSearchEngine(engine: BrowserSearchEngine): void;
  setZoom(profile: BrowserProfile, origin: string, zoom: number): void;
  clearZooms(profile: BrowserProfile): void;
  archive(): BrowserArchiveSetting;
  setArchive(setting: BrowserArchiveSetting): void;
  linksIn(): BrowserLinksIn;
  setLinksIn(choice: BrowserLinksIn): void;
}

export async function loadSavedView(
  userData: string,
  log: (line: string) => void,
): Promise<SavedViewStore> {
  const file = path.join(userData, FILE_NAME);
  let saved = parseSavedView(await readFile(file, 'utf8').catch(() => '{}'));
  let written = JSON.stringify(saved);
  let saving = Promise.resolve();
  const save = () => {
    const text = JSON.stringify(saved);
    if (text === written) return;
    written = text;
    saving = saving
      .then(() => writeFile(file, text, { mode: 0o600 }))
      .catch((error: Error) => log(`Could not save the Browser view tabs: ${error.message}`));
  };
  const change = (profile: BrowserProfile, next: Partial<SavedProfile>) => {
    saved = {
      ...saved,
      profiles: { ...saved.profiles, [profile]: { ...saved.profiles[profile], ...next } },
    };
    save();
  };
  return {
    get: (profile) => saved.profiles[profile],
    setTabs: (profile, tabs) => change(profile, { tabs: keptTabs(tabs) }),
    setFavorites: (profile, favorites) =>
      change(profile, { favorites: favorites.slice(0, BROWSER_FAVORITES_MAX) }),
    setZoom: (profile, origin, zoom) => {
      const others = Object.entries(saved.profiles[profile].zooms).filter(
        ([known]) => known !== origin,
      );
      const kept = zoom === 1 ? others : [...others, [origin, zoom] as const];
      change(profile, { zooms: keptZooms(Object.fromEntries(kept)) });
    },
    clearZooms: (profile) => change(profile, { zooms: {} }),
    setLayout: (profile, layout) => change(profile, layout),
    searchEngine: () => saved.searchEngine,
    setSearchEngine: (engine) => {
      saved = { ...saved, searchEngine: engine };
      save();
    },
    archive: () => saved.archive,
    setArchive: (setting) => {
      saved = { ...saved, archive: setting };
      save();
    },
    linksIn: () => saved.linksIn,
    setLinksIn: (choice) => {
      saved = { ...saved, linksIn: choice };
      save();
    },
  };
}
