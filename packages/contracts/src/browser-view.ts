import { z } from 'zod';
import { browserBoundsSchema, browserPaneTabSchema } from './browser.ts';
import { BROWSER_SHORTCUTS } from './browser-keys.ts';

export const BROWSER_VIEW_TABS_MAX = 40;

export const browserProfileSchema = z.enum(['personal', 'work']);
export type BrowserProfile = z.infer<typeof browserProfileSchema>;

export const browserViewPlacementSchema = z.object({
  profile: browserProfileSchema,
  bounds: browserBoundsSchema.nullable(),
  covered: z.boolean(),
});
export type BrowserViewPlacement = z.infer<typeof browserViewPlacementSchema>;

export const browserViewStateSchema = z.object({
  profile: browserProfileSchema,
  tabs: z.array(browserPaneTabSchema).max(BROWSER_VIEW_TABS_MAX),
});
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
