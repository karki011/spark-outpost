import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileStat } from './refresh-plan.ts';
import { isSkipped, MAX_FILE_BYTES } from './skip.ts';

const STAT_CONCURRENCY = 64;

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

async function statFile(root: string, path: string): Promise<FileStat | null> {
  try {
    const stats = await lstat(join(root, path));
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;
    return { path, size: stats.size, mtimeMs: Math.trunc(stats.mtimeMs) };
  } catch {
    return null;
  }
}

export async function statIndexable(root: string, paths: readonly string[]): Promise<FileStat[]> {
  const candidates = paths.filter((path) => !isSkipped(path));
  const stats = await mapLimit(candidates, STAT_CONCURRENCY, (path) => statFile(root, path));
  return stats.filter((stat): stat is FileStat => stat !== null);
}

export function textReader(root: string): (path: string) => Promise<string | null> {
  return async (path) => {
    try {
      return await readFile(join(root, path), 'utf8');
    } catch {
      return null;
    }
  };
}
