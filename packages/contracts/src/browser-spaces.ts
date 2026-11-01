import { z } from 'zod';
import { BROWSER_URL_MAX, parseBrowserUrl } from './browser.ts';
import type { ShortcutChord } from './browser-keys.ts';

export const BROWSER_SPACES_MAX = 9;
export const BROWSER_TAB_FOLDERS_MAX = 40;
export const BROWSER_ARCHIVED_MAX = 200;
export const BROWSER_NAME_MAX = 40;
export const BROWSER_ARCHIVE_DEFAULT_MINUTES = 12 * 60;
const ARCHIVE_MINUTES_MAX = 60 * 24 * 365;

export const BROWSER_SPACE_ICONS = [
  'home',
  'book',
  'people',
  'laptop',
  'cloud',
  'terminal',
  'video',
  'comment',
] as const;
export const BROWSER_SPACE_COLORS = ['accent', 'text', 'muted'] as const;

const idSchema = z.string().min(1).max(40);
const nameSchema = z.string().trim().min(1).max(BROWSER_NAME_MAX);

export const browserSpaceSchema = z.object({
  id: idSchema,
  name: nameSchema,
  icon: z.enum(BROWSER_SPACE_ICONS).catch('home'),
  color: z.enum(BROWSER_SPACE_COLORS).catch('accent'),
});
export type BrowserSpace = z.infer<typeof browserSpaceSchema>;

export const browserTabFolderSchema = z.object({
  id: idSchema,
  spaceId: idSchema,
  name: nameSchema,
  collapsed: z.boolean().catch(false),
});
export type BrowserTabFolder = z.infer<typeof browserTabFolderSchema>;

export const browserArchivedTabSchema = z.object({
  id: idSchema,
  url: z.string().min(1).max(BROWSER_URL_MAX),
  title: z.string().max(300),
  archivedAt: z.number().int().min(0),
});
export type BrowserArchivedTab = z.infer<typeof browserArchivedTabSchema>;

export const browserTabPlaceSchema = z.object({
  tabId: idSchema,
  spaceId: idSchema,
  folderId: idSchema.nullable(),
  pinnedUrl: z.string().max(BROWSER_URL_MAX).nullable(),
});
export type BrowserTabPlace = z.infer<typeof browserTabPlaceSchema>;

export const browserViewLayoutSchema = z.object({
  spaces: z.array(browserSpaceSchema).max(BROWSER_SPACES_MAX),
  currentSpaceId: z.string().max(40),
  folders: z.array(browserTabFolderSchema).max(BROWSER_TAB_FOLDERS_MAX),
  places: z.array(browserTabPlaceSchema),
  archived: z.array(browserArchivedTabSchema).max(BROWSER_ARCHIVED_MAX),
});
export type BrowserViewLayout = z.infer<typeof browserViewLayoutSchema>;

export const EMPTY_BROWSER_LAYOUT: BrowserViewLayout = {
  spaces: [],
  currentSpaceId: '',
  folders: [],
  places: [],
  archived: [],
};

export const browserArchiveSettingSchema = z.object({
  on: z.boolean(),
  afterMinutes: z.number().int().min(1).max(ARCHIVE_MINUTES_MAX),
});
export type BrowserArchiveSetting = z.infer<typeof browserArchiveSettingSchema>;

export const DEFAULT_BROWSER_ARCHIVE: BrowserArchiveSetting = {
  on: true,
  afterMinutes: BROWSER_ARCHIVE_DEFAULT_MINUTES,
};

const looks = {
  icon: z.enum(BROWSER_SPACE_ICONS),
  color: z.enum(BROWSER_SPACE_COLORS),
};

export const browserLayoutCommandOptions = [
  z.object({ command: z.literal('space_create'), name: nameSchema, ...looks }),
  z.object({ command: z.literal('space_update'), id: idSchema, name: nameSchema, ...looks }),
  z.object({ command: z.literal('space_delete'), id: idSchema }),
  z.object({ command: z.literal('space_switch'), id: idSchema }),
  z.object({ command: z.literal('tab_to_space'), tabId: idSchema, spaceId: idSchema }),
  z.object({ command: z.literal('folder_create'), name: nameSchema, tabId: idSchema.nullable() }),
  z.object({ command: z.literal('folder_rename'), id: idSchema, name: nameSchema }),
  z.object({ command: z.literal('folder_delete'), id: idSchema }),
  z.object({ command: z.literal('folder_collapse'), id: idSchema, collapsed: z.boolean() }),
  z.object({
    command: z.literal('tab_to_folder'),
    tabId: idSchema,
    folderId: idSchema.nullable(),
  }),
  z.object({ command: z.literal('pinned_home'), tabId: idSchema }),
  z.object({ command: z.literal('archived_open'), id: idSchema }),
  z.object({ command: z.literal('archived_remove'), id: idSchema }),
  z.object({ command: z.literal('archived_clear') }),
] as const;

const SPACE_DIGIT = /^Digit([1-9])$/;

export function browserSpaceKey(chord: ShortcutChord, mac: boolean): number | null {
  if (!mac || chord.composing) return null;
  if (!chord.ctrl || chord.meta || chord.alt || chord.shift) return null;
  const digit = SPACE_DIGIT.exec(chord.code);
  return digit ? Number(digit[1]) - 1 : null;
}

function pinnedPage(url: string): string {
  const parsed = parseBrowserUrl(url);
  if (!parsed) return url;
  return parsed.href.split('#')[0]!.replace(/\/+(\?|$)/, '$1');
}

export function wanderedFromPinned(current: string, pinnedUrl: string | null): boolean {
  if (pinnedUrl === null || current === '') return false;
  return pinnedPage(current) !== pinnedPage(pinnedUrl);
}
