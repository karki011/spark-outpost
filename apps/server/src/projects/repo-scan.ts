import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRemoteUrl, repoSlug } from '../ship/remote.ts';
import { isWithin } from './clone/clone-destination.ts';

export interface RepoScanLimits {
  maxDepth: number;
  maxEntries: number;
  deadline: number;
  now: () => number;
}

export interface FoundRepo {
  path: string;
  origin: string | null;
}

export interface RepoScan {
  repos: FoundRepo[];
  partial: boolean;
}

const GIT = '.git';
const SKIPPED_NAMES: ReadonlySet<string> = new Set(['node_modules']);

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function gitDirOf(root: string): Promise<string | null> {
  const dotGit = path.join(root, GIT);
  const file = await readText(dotGit);
  if (file === null) return dotGit;
  const pointer = /^gitdir:\s*(.+)$/m.exec(file)?.[1]?.trim();
  return pointer ? path.resolve(root, pointer) : null;
}

async function configFileOf(gitDir: string): Promise<string> {
  const common = (await readText(path.join(gitDir, 'commondir')))?.trim();
  return path.join(common ? path.resolve(gitDir, common) : gitDir, 'config');
}

export function originUrlIn(config: string): string | null {
  let inOrigin = false;
  for (const raw of config.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
      continue;
    }
    const url = inOrigin ? /^url\s*=\s*(.+)$/.exec(line)?.[1] : undefined;
    if (url) return url.trim();
  }
  return null;
}

export async function originOf(root: string): Promise<string | null> {
  const gitDir = await gitDirOf(root);
  if (!gitDir) return null;
  const config = await readText(await configFileOf(gitDir));
  const url = config === null ? null : originUrlIn(config);
  const repo = url ? parseRemoteUrl(url) : null;
  return repo ? repoSlug(repo) : null;
}

interface Pending {
  dir: string;
  depth: number;
}

function descends(name: string): boolean {
  return !name.startsWith('.') && !SKIPPED_NAMES.has(name);
}

export async function scanRepos(
  folders: readonly string[],
  skipped: readonly string[],
  limits: RepoScanLimits,
): Promise<RepoScan> {
  const queue: Pending[] = folders.map((dir) => ({ dir, depth: 0 }));
  const seen = new Set<string>();
  const found: string[] = [];
  let entries = 0;
  let partial = false;
  while (queue.length > 0) {
    if (entries >= limits.maxEntries || limits.now() >= limits.deadline) {
      partial = true;
      break;
    }
    const { dir, depth } = queue.shift()!;
    if (seen.has(dir) || skipped.some((skip) => isWithin(dir, skip))) continue;
    seen.add(dir);
    const listed = await readdir(dir, { withFileTypes: true }).catch(() => []);
    entries += listed.length;
    if (listed.some((entry) => entry.name === GIT && !entry.isSymbolicLink())) {
      found.push(dir);
      continue;
    }
    if (depth >= limits.maxDepth) continue;
    for (const entry of listed) {
      if (entry.isDirectory() && descends(entry.name)) {
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }
  }
  const repos = await Promise.all(
    found.map(async (repo) => ({ path: repo, origin: await originOf(repo) })),
  );
  return { repos, partial };
}

export interface RepoCandidate {
  name: string;
  path: string;
  origin: string | null;
}

export type RepoMatchKind = 'exact' | 'partial';

function namesOf(candidate: RepoCandidate): string[] {
  const names = [candidate.name, path.basename(candidate.path)];
  if (candidate.origin) names.push(candidate.origin, candidate.origin.split('/').at(-1)!);
  return names.map((name) => name.toLowerCase());
}

export function repoMatch(candidate: RepoCandidate, query: string): RepoMatchKind | null {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;
  const names = namesOf(candidate);
  if (names.includes(wanted)) return 'exact';
  return names.some((name) => name.includes(wanted)) ? 'partial' : null;
}
