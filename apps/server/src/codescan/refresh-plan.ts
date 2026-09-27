import type { FileJob } from './read-file.ts';

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
  return [...files]
    .sort((a, b) => {
      const recency = Number(recent.has(b.path)) - Number(recent.has(a.path));
      return recency !== 0 ? recency : b.mtimeMs - a.mtimeMs;
    })
    .slice(0, cap);
}
