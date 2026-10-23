import { z } from 'zod';
import {
  BROWSER_URL_MAX,
  browserBoundsSchema,
  browserCommandSchema,
  browserPaneTabSchema,
  parseBrowserUrl,
} from './browser.ts';
import { BROWSER_SHORTCUTS } from './browser-keys.ts';

export const BROWSER_VIEW_TABS_MAX = 40;
export const BROWSER_FAVORITES_MAX = 16;

export const browserProfileSchema = z.enum(['personal', 'work']);
export type BrowserProfile = z.infer<typeof browserProfileSchema>;

export const browserViewPlacementSchema = z.object({
  profile: browserProfileSchema,
  bounds: browserBoundsSchema.nullable(),
  covered: z.boolean(),
});
export type BrowserViewPlacement = z.infer<typeof browserViewPlacementSchema>;

export const browserFavoriteSchema = z.object({
  id: z.string().min(1).max(40),
  url: z.string().min(1).max(BROWSER_URL_MAX),
  title: z.string().max(300),
});
export type BrowserFavorite = z.infer<typeof browserFavoriteSchema>;

function favoritePage(url: string): string {
  const parsed = parseBrowserUrl(url);
  if (!parsed || parsed.origin === 'null') return url;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

export function sameFavoritePage(a: string, b: string): boolean {
  return favoritePage(a) === favoritePage(b);
}

export const browserViewStateSchema = z.object({
  profile: browserProfileSchema,
  tabs: z.array(browserPaneTabSchema).max(BROWSER_VIEW_TABS_MAX),
  favorites: z.array(browserFavoriteSchema).max(BROWSER_FAVORITES_MAX).default([]),
});

export const browserViewCommandSchema = z.discriminatedUnion('command', [
  ...browserCommandSchema.options,
  z.object({ command: z.literal('add_favorite'), tabId: z.string() }),
  z.object({ command: z.literal('remove_favorite'), id: z.string().min(1).max(40) }),
  z.object({ command: z.literal('open_favorite'), id: z.string().min(1).max(40) }),
]);
export type BrowserViewCommand = z.infer<typeof browserViewCommandSchema>;

export const browserHandToChatSchema = z.object({
  profile: browserProfileSchema,
  tabId: z.string().min(1).max(40),
  chatId: z.uuid(),
});
export type BrowserHandToChat = z.infer<typeof browserHandToChatSchema>;

export const browserToViewSchema = z.object({
  chatId: z.uuid(),
  tabId: z.string().min(1).max(40),
});
export type BrowserToView = z.infer<typeof browserToViewSchema>;
export type BrowserViewState = z.infer<typeof browserViewStateSchema>;

export const browserViewShortcutEventSchema = z.object({
  profile: browserProfileSchema,
  shortcut: z.enum(BROWSER_SHORTCUTS),
});
export type BrowserViewShortcutEvent = z.infer<typeof browserViewShortcutEventSchema>;

export const browserViewFoundSchema = z.object({
  profile: browserProfileSchema,
  tabId: z.string(),
  active: z.number().int().min(0),
  matches: z.number().int().min(0),
});
export type BrowserViewFound = z.infer<typeof browserViewFoundSchema>;

export const browserViewSnapshotSchema = z.object({
  profile: browserProfileSchema,
  image: z.string().max(8_000_000).nullable(),
});
export type BrowserViewSnapshot = z.infer<typeof browserViewSnapshotSchema>;

export const browserViewIntentSchema = z.object({
  profile: browserProfileSchema,
  tabId: z.string().min(1).max(40),
  kind: z.literal('new_chat'),
  selection: z.string().max(4000).nullable(),
  link: z.string().max(BROWSER_URL_MAX).nullable(),
});
export type BrowserViewIntent = z.infer<typeof browserViewIntentSchema>;

export const BROWSER_PAGE_TEXT_MAX = 12_000;

export const browserPageTextSchema = z.object({
  url: z.string().max(BROWSER_URL_MAX),
  title: z.string().max(300),
  text: z.string().max(BROWSER_PAGE_TEXT_MAX),
  main: z.boolean(),
});
export type BrowserPageText = z.infer<typeof browserPageTextSchema>;

export const browserSearchEngineSchema = z.enum(['duckduckgo', 'google', 'bing']);
export type BrowserSearchEngine = z.infer<typeof browserSearchEngineSchema>;
export const DEFAULT_SEARCH_ENGINE: BrowserSearchEngine = 'duckduckgo';

export const SEARCH_ENGINES: Record<BrowserSearchEngine, { label: string; base: string }> = {
  duckduckgo: { label: 'DuckDuckGo', base: 'https://duckduckgo.com/?q=' },
  google: { label: 'Google', base: 'https://www.google.com/search?q=' },
  bing: { label: 'Bing', base: 'https://www.bing.com/search?q=' },
};

export function searchUrl(engine: BrowserSearchEngine, text: string): string {
  return `${SEARCH_ENGINES[engine].base}${encodeURIComponent(text.trim())}`;
}
