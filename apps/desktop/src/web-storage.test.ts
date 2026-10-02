import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applySeed } from './storage-seed.ts';
import {
  cleanEntries,
  readSnapshot,
  sameEntries,
  seedFor,
  webStorageFile,
  writeSnapshot,
} from './web-storage.ts';

const OLD = 'http://127.0.0.1:31000';
const NEW = 'http://127.0.0.1:32000';
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe('captured settings', () => {
  it('keeps only Spark keys with string values', () => {
    expect(
      cleanEntries({
        'spark-outpost.view': 'chats',
        'spark-outpost.sidebar.width': '320',
        'other-lib.cache': 'x',
        'spark-outpost.bad': 4,
      }),
    ).toEqual({ 'spark-outpost.view': 'chats', 'spark-outpost.sidebar.width': '320' });
  });

  it('refuses anything that is not a plain object or is far too large', () => {
    for (const value of [null, 'x', ['a'], 3]) expect(cleanEntries(value)).toBeNull();
    expect(cleanEntries({ 'spark-big': 'x'.repeat(2_100_000) })).toBeNull();
  });

  it('compares snapshots by content', () => {
    expect(sameEntries({ 'spark-a': '1' }, { 'spark-a': '1' })).toBe(true);
    expect(sameEntries({ 'spark-a': '1' }, { 'spark-a': '2' })).toBe(false);
    expect(sameEntries({ 'spark-a': '1' }, { 'spark-a': '1', 'spark-b': '2' })).toBe(false);
  });
});

describe('restoring settings after the port changes', () => {
  const snapshot = { origin: OLD, entries: { 'spark-outpost.view': 'map' } };

  it('restores nothing while the origin is unchanged', () => {
    expect(seedFor(snapshot, OLD)).toBeNull();
    expect(seedFor(null, NEW)).toBeNull();
  });

  it('restores the saved settings on a new origin', () => {
    expect(seedFor(snapshot, NEW)).toEqual({ 'spark-outpost.view': 'map' });
  });

  it('replaces stale Spark keys and leaves other keys alone', () => {
    const storage = new MemoryStorage();
    storage.setItem('spark-outpost.view', 'home');
    storage.setItem('spark-outpost.island', '{"old":true}');
    storage.setItem('vendor.flag', '1');
    applySeed(storage, { 'spark-outpost.view': 'map', 'spark-outpost.theme': 'fjord' });
    expect(storage.getItem('spark-outpost.view')).toBe('map');
    expect(storage.getItem('spark-outpost.theme')).toBe('fjord');
    expect(storage.getItem('spark-outpost.island')).toBeNull();
    expect(storage.getItem('vendor.flag')).toBe('1');
  });
});

describe('snapshot file', () => {
  it('round-trips and ignores a damaged file', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'spark-storage-'));
    folders.push(folder);
    const file = webStorageFile(folder);
    expect(await readSnapshot(file)).toBeNull();
    await writeSnapshot(file, { origin: OLD, entries: { 'spark-outpost.view': 'map' } });
    expect(await readSnapshot(file)).toEqual({
      origin: OLD,
      entries: { 'spark-outpost.view': 'map' },
    });
    writeFileSync(file, '{"origin": 5}');
    expect(await readSnapshot(file)).toBeNull();
  });
});
