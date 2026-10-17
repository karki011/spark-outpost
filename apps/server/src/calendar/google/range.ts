import type { HelperEvent } from '@spark-outpost/contracts';
import { accountRange, GOOGLE_POLL_MS, type AccountDeps, type LiveAccount } from './accounts.ts';
import { collectEvents, type CalendarSync, type GoogleWindow } from './sync.ts';

export const GOOGLE_RANGE_CACHE_MAX = 6;

interface RangeEntry {
  at: number;
  accountId: string;
  loading: Promise<Map<string, CalendarSync>>;
}

export interface GoogleRangeEvents {
  events: HelperEvent[];
  truncated: boolean;
}

export interface GoogleRangeCache {
  read(window: GoogleWindow, accounts: readonly LiveAccount[]): Promise<GoogleRangeEvents>;
  dropAccount(accountId: string): void;
  clear(): void;
}

export function createGoogleRangeCache(deps: AccountDeps): GoogleRangeCache {
  const entries = new Map<string, RangeEntry>();
  const entryFor = (window: GoogleWindow, account: LiveAccount, cap: number): RangeEntry => {
    const key = `${account.row.id}|${window.key}`;
    const known = entries.get(key);
    if (known && deps.now() - known.at < GOOGLE_POLL_MS) return known;
    const entry: RangeEntry = {
      at: deps.now(),
      accountId: account.row.id,
      loading: accountRange(deps, account, window),
    };
    entry.loading.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > cap) entries.delete(entries.keys().next().value!);
    return entry;
  };

  return {
    async read(window, accounts) {
      const cap = GOOGLE_RANGE_CACHE_MAX * Math.max(1, accounts.length);
      const results = await Promise.allSettled(
        accounts.map((account) => entryFor(window, account, cap).loading),
      );
      const syncs: CalendarSync[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') syncs.push(...result.value.values());
        else console.error('Google Calendar range failed', (result.reason as Error).message);
      }
      return collectEvents(syncs, window);
    },
    dropAccount(accountId) {
      for (const [key, entry] of entries) {
        if (entry.accountId === accountId) entries.delete(key);
      }
    },
    clear: () => entries.clear(),
  };
}
