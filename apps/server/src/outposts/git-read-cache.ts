import { createHash } from 'node:crypto';
import { runGit } from '../ship/git.ts';
import type { StackGit } from './ports.ts';

const TTL_MS = 15_000;
const PRUNE_ABOVE = 500;

interface Entry {
  signature: string;
  expiresAt: number;
  value: Promise<unknown>;
}

export interface GitReadCache {
  read<T>(root: string, key: string, load: () => Promise<T>): Promise<T>;
}

export interface GitReadCacheOptions {
  ttlMs: number;
  now: () => number;
  snapshot: (root: string) => Promise<string>;
}

export function createGitReadCache(options: GitReadCacheOptions): GitReadCache {
  const entries = new Map<string, Entry>();
  const snapshots = new Map<string, Promise<string>>();

  const snapshotOf = (root: string): Promise<string> => {
    const pending = snapshots.get(root);
    if (pending) return pending;
    const taking = options.snapshot(root).finally(() => snapshots.delete(root));
    snapshots.set(root, taking);
    return taking;
  };

  const prune = (): void => {
    if (entries.size <= PRUNE_ABOVE) return;
    const now = options.now();
    for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  };

  return {
    async read<T>(root: string, key: string, load: () => Promise<T>): Promise<T> {
      const signature = await snapshotOf(root);
      const entryKey = `${root}\0${key}`;
      const known = entries.get(entryKey);
      if (known && known.signature === signature && known.expiresAt > options.now()) {
        return known.value as Promise<T>;
      }
      const value = load();
      prune();
      entries.set(entryKey, { signature, expiresAt: options.now() + options.ttlMs, value });
      value.catch(() => {
        if (entries.get(entryKey)?.value === value) entries.delete(entryKey);
      });
      return value;
    },
  };
}

let unreadable = 0;

async function signatureOf(root: string, commands: string[][]): Promise<string> {
  const hash = createHash('sha1');
  for (const command of commands) {
    const result = await runGit(root, command);
    if (result.code !== 0) {
      unreadable += 1;
      return `unreadable:${unreadable}`;
    }
    hash.update(result.stdout).update('\0');
  }
  return hash.digest('hex');
}

const REFS = ['for-each-ref', '--format=%(objectname) %(refname)'];
const WORKTREE = ['status', '--porcelain=v2', '--branch'];

export const sharedGitReads: GitReadCache = createGitReadCache({
  ttlMs: TTL_MS,
  now: Date.now,
  snapshot: (root) => signatureOf(root, [REFS]),
});

export const sharedWorkReads: GitReadCache = createGitReadCache({
  ttlMs: TTL_MS,
  now: Date.now,
  snapshot: (root) => signatureOf(root, [REFS, WORKTREE]),
});

export function cachedStackGit(git: StackGit, reads: GitReadCache = sharedGitReads): StackGit {
  return {
    isAncestor: (repoRoot, ancestor, descendant) =>
      reads.read(repoRoot, `ancestor\0${ancestor}\0${descendant}`, () =>
        git.isAncestor(repoRoot, ancestor, descendant),
      ),
    branchOnRemote: (repoRoot, branch) =>
      reads.read(repoRoot, `remote\0${branch}`, () => git.branchOnRemote(repoRoot, branch)),
  };
}
