import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  BROWSER_FAVORITES_MAX,
  BROWSER_URL_MAX,
  BROWSER_VIEW_TABS_MAX,
  DEFAULT_SEARCH_ENGINE,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  browserFavoriteSchema,
  browserSearchEngineSchema,
  classifyBrowserUrl,
  type BrowserFavorite,
  type BrowserProfile,
  type BrowserSearchEngine,
} from '@spark-outpost/contracts';

const FILE_NAME = 'browser-view.json';

const savedTabSchema = z.object({
  url: z.string().min(1).max(BROWSER_URL_MAX),
  title: z.string().max(300),
  pinned: z.boolean(),
  active: z.boolean(),
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
  tabs: z.array(savedTabSchema).max(BROWSER_VIEW_TABS_MAX),
  favorites: z.array(browserFavoriteSchema).max(BROWSER_FAVORITES_MAX),
});
export type SavedProfile = z.infer<typeof savedProfileSchema>;

const savedViewSchema = z.object({
  version: z.literal(1),
  profiles: z.object({ personal: savedProfileSchema, work: savedProfileSchema }),
  searchEngine: browserSearchEngineSchema
    .catch(DEFAULT_SEARCH_ENGINE)
    .default(DEFAULT_SEARCH_ENGINE),
});
export type SavedView = z.infer<typeof savedViewSchema>;

const EMPTY_PROFILE: SavedProfile = { tabs: [], favorites: [] };

export function emptySavedView(): SavedView {
  return {
    version: 1,
    profiles: { personal: EMPTY_PROFILE, work: EMPTY_PROFILE },
    searchEngine: DEFAULT_SEARCH_ENGINE,
  };
}

function webAddress(url: string): boolean {
  const kind = classifyBrowserUrl(url);
  return kind === 'local' || kind === 'external';
}

export function parseSavedView(text: string): SavedView {
  try {
    const parsed = savedViewSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return emptySavedView();
    const clean = (profile: SavedProfile): SavedProfile => ({
      tabs: profile.tabs.filter((tab) => webAddress(tab.url)),
      favorites: profile.favorites.filter((favorite) => webAddress(favorite.url)),
    });
    return {
      version: 1,
      profiles: {
        personal: clean(parsed.data.profiles.personal),
        work: clean(parsed.data.profiles.work),
      },
      searchEngine: parsed.data.searchEngine,
    };
  } catch {
    return emptySavedView();
  }
}

export function keptTabs(tabs: readonly SavedTab[]): SavedTab[] {
  return tabs.filter((tab) => webAddress(tab.url)).slice(0, BROWSER_VIEW_TABS_MAX);
}

export interface SavedViewStore {
  get(profile: BrowserProfile): SavedProfile;
  setTabs(profile: BrowserProfile, tabs: readonly SavedTab[]): void;
  setFavorites(profile: BrowserProfile, favorites: readonly BrowserFavorite[]): void;
  searchEngine(): BrowserSearchEngine;
  setSearchEngine(engine: BrowserSearchEngine): void;
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
    searchEngine: () => saved.searchEngine,
    setSearchEngine: (engine) => {
      saved = { ...saved, searchEngine: engine };
      save();
    },
  };
}
