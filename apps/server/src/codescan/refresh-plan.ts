import type { FileJob } from './read-file.ts';
import { isBulkData } from './skip.ts';

export const PROJECT_FILE_CAP = 50_000;

export interface FileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface CachedFile extends FileStat {
  hash: string;
}

export interface RefreshPlan {
  read: FileJob[];
  remove: string[];
  kept: number;
}

export interface CachedProjectState {
  status: 'building' | 'ready';
  parserVersion: string;
  fileParserVersions: readonly string[];
}

export function rebuildReason(state: CachedProjectState, parserVersion: string): string | null {
  if (state.status !== 'ready') return 'an earlier build did not finish';
  if (state.parserVersion !== parserVersion) return 'the parser version changed';
  if (state.fileParserVersions.some((version) => version !== parserVersion)) {
    return 'some rows have another parser version';
  }
  return null;
}

function statChanged(cached: CachedFile, current: FileStat): boolean {
  return cached.size !== current.size || cached.mtimeMs !== current.mtimeMs;
}

export function planRefresh(
  cached: ReadonlyMap<string, CachedFile>,
  current: readonly FileStat[],
  changedInGit: ReadonlySet<string>,
): RefreshPlan {
  const read: FileJob[] = [];
  let kept = 0;
  for (const file of current) {
    const known = cached.get(file.path);
    if (!known) read.push({ path: file.path, knownHash: null });
    else if (changedInGit.has(file.path) || statChanged(known, file)) {
      read.push({ path: file.path, knownHash: known.hash });
    } else kept += 1;
  }
  const present = new Set(current.map((file) => file.path));
  const remove = [...cached.keys()].filter((path) => !present.has(path));
  return { read, remove, kept };
}

export function withinCap(
  files: readonly FileStat[],
  cap: number,
  recent: ReadonlySet<string>,
): FileStat[] {
  if (files.length <= cap) return [...files];
  return files
    .filter((file) => !isBulkData(file.path))
    .sort((a, b) => {
      const recency = Number(recent.has(b.path)) - Number(recent.has(a.path));
      return recency !== 0 ? recency : b.mtimeMs - a.mtimeMs;
    })
    .slice(0, cap);
}

export const MAX_SEARCH_EXCLUDES = 200;

function ancestors(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

export function uncoveredDirectories(
  listed: readonly string[],
  kept: ReadonlySet<string>,
): string[] {
  const counts = new Map<string, { listed: number; kept: number }>();
  for (const path of listed) {
    for (const directory of ancestors(path)) {
      const entry = counts.get(directory) ?? { listed: 0, kept: 0 };
      entry.listed += 1;
      if (kept.has(path)) entry.kept += 1;
      counts.set(directory, entry);
    }
  }
  const uncovered = [...counts].filter(([directory, entry]) => {
    if (entry.kept > 0) return false;
    const parent = directory.slice(0, Math.max(0, directory.lastIndexOf('/')));
    return parent === '' || (counts.get(parent)?.kept ?? 0) > 0;
  });
  return uncovered
    .sort((a, b) => b[1].listed - a[1].listed || a[0].localeCompare(b[0]))
    .slice(0, MAX_SEARCH_EXCLUDES)
    .map(([directory]) => directory)
    .sort();
}
