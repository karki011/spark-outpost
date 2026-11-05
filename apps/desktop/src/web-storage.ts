import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { KEY_PREFIX, type StorageEntries } from './storage-seed.ts';
const MAX_KEY = 200;
const MAX_TOTAL = 2_000_000;

export interface StorageSnapshot {
  origin: string;
  entries: StorageEntries;
}

export function cleanEntries(value: unknown): StorageEntries | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries: StorageEntries = {};
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    if (!key.startsWith(KEY_PREFIX) || key.length > MAX_KEY || typeof item !== 'string') continue;
    total += key.length + item.length;
    if (total > MAX_TOTAL) return null;
    entries[key] = item;
  }
  return entries;
}

export function parseSnapshot(value: unknown): StorageSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const { origin, entries } = value as { origin?: unknown; entries?: unknown };
  if (typeof origin !== 'string') return null;
  const clean = cleanEntries(entries);
  return clean ? { origin, entries: clean } : null;
}

export function seedFor(snapshot: StorageSnapshot | null, origin: string): StorageEntries | null {
  if (!snapshot || snapshot.origin === origin) return null;
  return snapshot.entries;
}

export function sameEntries(a: StorageEntries, b: StorageEntries): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

export function webStorageFile(userData: string): string {
  return path.join(userData, 'web-storage.json');
}

export async function readSnapshot(file: string): Promise<StorageSnapshot | null> {
  try {
    return parseSnapshot(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

export async function writeSnapshot(file: string, snapshot: StorageSnapshot): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  await writeFile(partial, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(partial, file);
}
