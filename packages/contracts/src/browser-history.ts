import { z } from 'zod';
import { BROWSER_URL_MAX } from './browser.ts';
import { redactQuery } from './browser-network.ts';
import { browserProfileSchema } from './browser-view.ts';

export const BROWSER_HISTORY_TITLE_MAX = 300;
export const BROWSER_HISTORY_QUERY_MAX = 200;
export const BROWSER_HISTORY_LIMIT_MAX = 50;

export function historyUrl(url: string): string | null {
  if (url.length > BROWSER_URL_MAX || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return redactQuery(parsed.href);
}

const historyUrlSchema = z
  .string()
  .max(BROWSER_URL_MAX)
  .refine((url) => historyUrl(url) === url, 'Only a web address, with secrets hidden.');

export const browserHistoryEventSchema = z.object({
  kind: z.enum(['visit', 'title']),
  profile: browserProfileSchema,
  url: historyUrlSchema,
  title: z.string().max(BROWSER_HISTORY_TITLE_MAX),
});
export type BrowserHistoryEvent = z.infer<typeof browserHistoryEventSchema>;

export const browserHistoryQuerySchema = z.object({
  profile: browserProfileSchema,
  q: z.string().max(BROWSER_HISTORY_QUERY_MAX).default(''),
  limit: z.coerce.number().int().min(1).max(BROWSER_HISTORY_LIMIT_MAX).default(8),
});
export type BrowserHistoryQuery = z.infer<typeof browserHistoryQuerySchema>;

export const browserHistoryEntrySchema = z.object({
  profile: browserProfileSchema,
  url: z.string().max(BROWSER_URL_MAX),
  title: z.string().max(BROWSER_HISTORY_TITLE_MAX),
  visitCount: z.number().int().positive(),
  lastVisitedAt: z.string(),
});
export type BrowserHistoryEntry = z.infer<typeof browserHistoryEntrySchema>;

export const browserHistoryListSchema = z.object({
  entries: z.array(browserHistoryEntrySchema),
});
export type BrowserHistoryList = z.infer<typeof browserHistoryListSchema>;

export const BROWSER_HISTORY_RANGES = ['hour', 'day', 'week', 'all'] as const;
export type BrowserHistoryRange = (typeof BROWSER_HISTORY_RANGES)[number];

export const browserHistoryClearSchema = z.object({
  profile: browserProfileSchema.nullable(),
  range: z.enum(BROWSER_HISTORY_RANGES),
});
export type BrowserHistoryClear = z.infer<typeof browserHistoryClearSchema>;

export const browserHistoryClearedSchema = z.object({ removed: z.number().int().nonnegative() });

const RANGE_MS: Record<Exclude<BrowserHistoryRange, 'all'>, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

export function historySince(range: BrowserHistoryRange, now: Date): Date | null {
  return range === 'all' ? null : new Date(now.getTime() - RANGE_MS[range]);
}
