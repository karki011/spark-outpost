import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { ListedFile } from './change-list.ts';
import { git } from './snapshot.ts';

const MAX_LISTINGS = 32;
const LISTING_TTL_MS = 10 * 60_000;
const STAT_BATCH = 64;
const PLAIN_ENTRY_FIELDS: Record<string, number> = { '1': 8, '2': 9, u: 10 };

export interface DirtyPaths {
  paths: string[];
  exact: boolean;
}

export function parseStatus(output: string): DirtyPaths {
  const parts = output.split('\0');
  const paths: string[] = [];
  let exact = true;
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index]!;
    const kind = entry.charAt(0);
    if (kind === '?') {
      paths.push(entry.slice(2));
      continue;
    }
    const fields = PLAIN_ENTRY_FIELDS[kind];
    if (fields === undefined) continue;
    const pieces = entry.split(' ');
    if (pieces[2] !== 'N...') exact = false;
    paths.push(pieces.slice(fields).join(' '));
    if (kind === '2') index += 1;
  }
  if (paths.some((changed) => changed.endsWith('/'))) exact = false;
  return { paths, exact };
}

const topLevels = new Map<string, Promise<string>>();

function topLevel(root: string): Promise<string> {
  let found = topLevels.get(root);
  if (!found) {
    found = git(root, ['rev-parse', '--show-toplevel']).then((output) => output.trimEnd());
    topLevels.set(root, found);
    found.catch(() => topLevels.delete(root));
  }
  return found;
}

async function statLine(target: string): Promise<string> {
  try {
    const stats = await lstat(target, { bigint: true });
    return `${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.ino}:${stats.mode}`;
  } catch {
    return 'gone';
  }
}

async function workingTreeSignature(root: string): Promise<string | null> {
  const [top, status] = await Promise.all([
    topLevel(root),
    git(root, [
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=all',
    ]),
  ]);
  const dirty = parseStatus(status);
  if (!dirty.exact) return null;
  const hash = createHash('sha1').update(status);
  for (let start = 0; start < dirty.paths.length; start += STAT_BATCH) {
    const batch = dirty.paths.slice(start, start + STAT_BATCH);
    const lines = await Promise.all(batch.map((changed) => statLine(path.join(top, changed))));
    hash.update(lines.join('\n'));
  }
  return hash.digest('hex');
}

async function refsSignature(root: string): Promise<string> {
  const refs = await git(root, ['for-each-ref', '--format=%(objectname) %(refname)']);
  return createHash('sha1').update(refs).digest('hex');
}

export interface ListedRange {
  root: string;
  from: string;
  until: string | null;
}

export async function rangeSignature(range: ListedRange): Promise<string | null> {
  try {
    const [refs, tree] = await Promise.all([
      refsSignature(range.root),
      range.until ?? workingTreeSignature(range.root),
    ]);
    if (tree === null) return null;
    return [range.root, range.from, range.until === null ? 'live' : 'fixed', tree, refs].join('\0');
  } catch {
    return null;
  }
}

interface Listing {
  files: ListedFile[];
  storedAt: number;
}

export class RunListingCache {
  private readonly listings = new Map<string, Listing>();

  constructor(private readonly now: () => number = Date.now) {}

  get(signature: string): ListedFile[] | undefined {
    const listing = this.listings.get(signature);
    if (!listing) return undefined;
    if (this.now() - listing.storedAt >= LISTING_TTL_MS) {
      this.listings.delete(signature);
      return undefined;
    }
    this.listings.delete(signature);
    this.listings.set(signature, listing);
    return listing.files;
  }

  set(signature: string, files: ListedFile[]): void {
    this.listings.delete(signature);
    this.listings.set(signature, { files, storedAt: this.now() });
    for (const oldest of this.listings.keys()) {
      if (this.listings.size <= MAX_LISTINGS) break;
      this.listings.delete(oldest);
    }
  }
}
