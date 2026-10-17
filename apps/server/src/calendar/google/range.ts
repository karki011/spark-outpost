import type { HelperEvent } from '@spark-outpost/contracts';
import { accountRange, GOOGLE_POLL_MS, type AccountDeps, type LiveAccount } from './accounts.ts';
import { eventsInWindow, type CalendarSync, type GoogleWindow, type StoredEvent } from './sync.ts';

export const GOOGLE_RANGE_CACHE_MAX = 6;

interface RangeEntry {
  at: number;
  window: GoogleWindow;
  loading: Promise<Map<string, Map<string, CalendarSync>>>;
  settled: Map<string, Map<string, CalendarSync>> | null;
}

export interface GoogleRangeEvents {
  events: HelperEvent[];
  truncated: boolean;
}

export interface GoogleRangeCache {
  read(window: GoogleWindow, accounts: readonly LiveAccount[]): Promise<GoogleRangeEvents>;
  find(accountId: string, eventId: string, at: number): StoredEvent | null;
  clear(): void;
}

async function loadAll(deps: AccountDeps, accounts: readonly LiveAccount[], window: GoogleWindow) {
  const found = new Map<string, Map<string, CalendarSync>>();
  for (const account of accounts) {
    try {
      found.set(account.row.id, await accountRange(deps, account, window));
    } catch (error) {
      console.error('Google Calendar range failed', (error as Error).message);
    }
  }
  return found;
}

export function createGoogleRangeCache(deps: AccountDeps): GoogleRangeCache {
  const entries = new Map<string, RangeEntry>();

  const fresh = (entry: RangeEntry) => deps.now() - entry.at < GOOGLE_POLL_MS;

  const entryFor = (window: GoogleWindow, accounts: readonly LiveAccount[]) => {
    const key = `${window.from}|${window.to}`;
    const known = entries.get(key);
    if (known && fresh(known)) return known;
    const entry: RangeEntry = {
      at: deps.now(),
      window,
      loading: loadAll(deps, accounts, window),
      settled: null,
    };
    entries.delete(key);
    entries.set(key, entry);
    void entry.loading.then((loaded) => {
      entry.settled = loaded;
    });
    while (entries.size > GOOGLE_RANGE_CACHE_MAX) entries.delete(entries.keys().next().value!);
    return entry;
  };

  return {
    async read(window, accounts) {
      const loaded = await entryFor(window, accounts).loading;
      const events: HelperEvent[] = [];
      let truncated = false;
      for (const account of accounts) {
        for (const sync of loaded.get(account.row.id)?.values() ?? []) {
          truncated ||= sync.truncated;
          events.push(...eventsInWindow(sync, window).map((entry) => entry.event));
        }
      }
      return { events, truncated };
    },
    find(accountId, eventId, at) {
      for (const entry of entries.values()) {
        for (const sync of entry.settled?.get(accountId)?.values() ?? []) {
          const found = sync.events.get(eventId);
          if (found && Date.parse(found.event.start) === at) return found;
        }
      }
      return null;
    },
    clear: () => entries.clear(),
  };
}
