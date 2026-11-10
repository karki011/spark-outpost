export const GH_CLI_TTL_MS = 60_000;

interface Entry<T> {
  expiresAt: number;
  value: Promise<T>;
}

export interface TtlCache<T> {
  get(key: string, now: number, load: () => Promise<T>): Promise<T>;
  set(key: string, now: number, value: T): void;
  invalidate(key?: string): void;
}

export function createTtlCache<T>(ttlMs: number): TtlCache<T> {
  const entries = new Map<string, Entry<T>>();
  return {
    get(key, now, load) {
      const found = entries.get(key);
      if (found && found.expiresAt > now) return found.value;
      const value = load();
      const entry = { expiresAt: now + ttlMs, value };
      entries.set(key, entry);
      value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return value;
    },
    set(key, now, value) {
      entries.set(key, { expiresAt: now + ttlMs, value: Promise.resolve(value) });
    },
    invalidate(key) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}
