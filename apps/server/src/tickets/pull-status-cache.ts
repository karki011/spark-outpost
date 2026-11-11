import type { PullRequestStatus } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

export const PULL_STATUS_TTL_MS = 90_000;

interface Store {
  fresh: Map<string, { at: number; status: PullRequestStatus }>;
  reading: Map<string, Promise<PullRequestStatus | null>>;
}

const stores = new WeakMap<Queryable, Store>();

function storeOf(db: Queryable): Store {
  const known = stores.get(db);
  if (known) return known;
  const created: Store = { fresh: new Map(), reading: new Map() };
  stores.set(db, created);
  return created;
}

export interface PullStatusCache {
  db: Queryable;
  now: number;
}

export function forgetPullStatuses(db: Queryable): void {
  const store = stores.get(db);
  store?.fresh.clear();
  store?.reading.clear();
}

export function cachedPullStatus(
  cache: PullStatusCache,
  key: string,
  read: () => Promise<PullRequestStatus | null>,
): Promise<PullRequestStatus | null> {
  const store = storeOf(cache.db);
  const known = store.fresh.get(key);
  if (known && cache.now - known.at < PULL_STATUS_TTL_MS) return Promise.resolve(known.status);
  const reading = store.reading.get(key);
  if (reading) return reading;
  const started = read()
    .then((status) => {
      const current = store.reading.get(key) === started;
      if (status && current) store.fresh.set(key, { at: cache.now, status });
      return status;
    })
    .finally(() => {
      if (store.reading.get(key) === started) store.reading.delete(key);
    });
  store.reading.set(key, started);
  return started;
}
