import {
  browserHistoryClearedSchema,
  browserHistoryListSchema,
  type BrowserHistoryClear,
  type BrowserHistoryEntry,
  type BrowserProfile,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const browserHistoryKey = ['browser-history'] as const;

export const browserHistoryApi = {
  search: (
    profile: BrowserProfile,
    q: string,
    signal?: AbortSignal,
  ): Promise<BrowserHistoryEntry[]> =>
    request(
      browserHistoryListSchema,
      `/browser-history?${new URLSearchParams({ profile, q, limit: '8' }).toString()}`,
      signal ? { signal } : {},
    ).then((list) => list.entries),
  clear: (clear: BrowserHistoryClear): Promise<number> =>
    request(browserHistoryClearedSchema, '/browser-history/clear', {
      method: 'POST',
      body: JSON.stringify(clear),
    }).then((result) => result.removed),
};
