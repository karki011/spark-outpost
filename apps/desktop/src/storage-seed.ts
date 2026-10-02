export const KEY_PREFIX = 'spark-';

export type StorageEntries = Record<string, string>;

export function applySeed(storage: Storage, entries: StorageEntries): void {
  const stale = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key !== null && key.startsWith(KEY_PREFIX),
  );
  for (const key of stale) storage.removeItem(key);
  for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
}
