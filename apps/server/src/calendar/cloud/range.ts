import { CLOUD_POLL_MS } from './poll.ts';
import { collectEvents, type CalendarSync, type SyncWindow, type WindowEvents } from './events.ts';

export const RANGE_CACHE_MAX = 6;

interface RangeEntry {
  at: number;
  accountId: string;
  loading: Promise<Map<string, CalendarSync>>;
}

export interface RangeCache<Account> {
  read(window: SyncWindow, accounts: readonly Account[]): Promise<WindowEvents>;
  dropAccount(accountId: string): void;
  clear(): void;
}

export interface RangeCacheDeps<Account> {
  now: () => number;
  label: string;
  idOf: (account: Account) => string;
  load: (account: Account, window: SyncWindow) => Promise<Map<string, CalendarSync>>;
}

export function createRangeCache<Account>(deps: RangeCacheDeps<Account>): RangeCache<Account> {
  const entries = new Map<string, RangeEntry>();
  const entryFor = (window: SyncWindow, account: Account, cap: number): RangeEntry => {
    const accountId = deps.idOf(account);
    const key = `${accountId}|${window.key}`;
    const known = entries.get(key);
    if (known && deps.now() - known.at < CLOUD_POLL_MS) return known;
    const entry: RangeEntry = { at: deps.now(), accountId, loading: deps.load(account, window) };
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
      const cap = RANGE_CACHE_MAX * Math.max(1, accounts.length);
      const results = await Promise.allSettled(
        accounts.map((account) => entryFor(window, account, cap).loading),
      );
      const syncs: CalendarSync[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') syncs.push(...result.value.values());
        else console.error(`${deps.label} range failed`, (result.reason as Error).message);
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
