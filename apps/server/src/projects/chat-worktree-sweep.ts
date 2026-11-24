import {
  archivedOrDeleted,
  chatHasOpenRun,
  sweepableChatWorktrees,
  type ChatWorktree,
} from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { releaseChatWorktree, type Released, type ReleaseReason } from './chat-worktree-cleanup.ts';
import { branchMerged, repoRefsOf, tipMergedAt, type RepoRefs } from './chat-worktrees.ts';

const SWEEP_EVERY_MS = 60_000;
const REPOS_AT_ONCE = 4;
const MERGED_KEPT_RECHECK_MS = 24 * 60 * 60_000;
const mergedKeptAt = new Map<string, number>();
const unmergedAt = new Map<string, string>();

export type RefsOf = (repoRoot: string) => Promise<RepoRefs | null>;

export function refsKey(refs: RepoRefs | null, branch: string): string | null {
  if (!refs) return null;
  return [refs.tips.get(branch) ?? '', refs.head ?? '', refs.remoteDefault ?? ''].join(' ');
}

export function oncePerRepo(read: (repoRoot: string) => Promise<RepoRefs | null>): RefsOf {
  const reads = new Map<string, Promise<RepoRefs | null>>();
  return (repoRoot) => {
    const known = reads.get(repoRoot);
    if (known) return known;
    const next = read(repoRoot).catch(() => null);
    reads.set(repoRoot, next);
    return next;
  };
}

export type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;

export type Sweep = (db: Queryable, exclusive: Exclusive, signal: AbortSignal) => Promise<void>;

export interface WorktreeSweeper {
  exclusive: Exclusive;
  stop(): Promise<void>;
}

function oneAtATime(): Exclusive {
  let last: Promise<unknown> = Promise.resolve();
  return (work) => {
    const next = last.then(work);
    last = next.catch(() => undefined);
    return next;
  };
}

export async function eachByRepo<T extends { repoRoot: string }>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const byRepo = new Map<string, T[]>();
  for (const item of items) byRepo.set(item.repoRoot, [...(byRepo.get(item.repoRoot) ?? []), item]);
  const groups = [...byRepo.values()];
  const drain = async () => {
    for (let group = groups.shift(); group; group = groups.shift()) {
      for (const item of group) await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, groups.length) }, drain));
}

async function releaseIdle(
  db: Queryable,
  record: ChatWorktree,
  reason: ReleaseReason,
  exclusive: Exclusive,
): Promise<Released | null> {
  return exclusive(async () => {
    const chat = record.conversationId;
    if (chat && (await chatHasOpenRun(db, chat))) return null;
    if (chat && reason === 'archived' && !(await archivedOrDeleted(db, chat))) return null;
    return releaseChatWorktree(db, record, reason);
  });
}

function mergedRecheckDue(id: string, now: number): boolean {
  const keptAt = mergedKeptAt.get(id);
  return keptAt === undefined || now - keptAt >= MERGED_KEPT_RECHECK_MS;
}

async function sweepOne(
  db: Queryable,
  record: ChatWorktree,
  exclusive: Exclusive,
  refsOf: RefsOf,
): Promise<void> {
  if (!record.conversationId) {
    await releaseIdle(db, record, 'deleted', exclusive);
    return;
  }
  if (await archivedOrDeleted(db, record.conversationId)) {
    await releaseIdle(db, record, 'archived', exclusive);
    return;
  }
  const now = Date.now();
  if (!mergedRecheckDue(record.id, now)) return;
  const refs = await refsOf(record.repoRoot);
  const key = refsKey(refs, record.branch);
  if (key !== null && unmergedAt.get(record.id) === key) return;
  const tip = refs?.tips.get(record.branch) ?? null;
  const merged = refs
    ? await tipMergedAt(record.repoRoot, refs, tip, record.baseCommit)
    : await branchMerged(record.repoRoot, record.branch, record.baseCommit);
  if (!merged) {
    if (key === null || merged === null) unmergedAt.delete(record.id);
    else unmergedAt.set(record.id, key);
    return;
  }
  unmergedAt.delete(record.id);
  const released = await releaseIdle(db, record, 'merged', exclusive);
  if (released && !released.removed && !released.inUse) mergedKeptAt.set(record.id, now);
  else mergedKeptAt.delete(record.id);
}

export async function sweepChatWorktrees(
  db: Queryable,
  exclusive: Exclusive,
  signal: AbortSignal,
): Promise<void> {
  const records = await sweepableChatWorktrees(db);
  const refsOf = oncePerRepo(repoRefsOf);
  const live = new Set(records.map((record) => record.id));
  for (const id of unmergedAt.keys()) if (!live.has(id)) unmergedAt.delete(id);
  await eachByRepo(records, REPOS_AT_ONCE, async (record) => {
    if (signal.aborted) return;
    await sweepOne(db, record, exclusive, refsOf).catch((error: unknown) =>
      console.error(`Could not sweep the worktree on ${record.branch}`, error),
    );
  });
}

export function startWorktreeSweeper(
  db: Queryable,
  everyMs = SWEEP_EVERY_MS,
  sweep: Sweep = sweepChatWorktrees,
): WorktreeSweeper {
  const exclusive = oneAtATime();
  const stopping = new AbortController();
  let wakeUp: (() => void) | null = null;
  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, everyMs);
      timer.unref();
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  const loop = (async () => {
    while (!stopping.signal.aborted) {
      await sweep(db, exclusive, stopping.signal).catch((error: unknown) =>
        console.error('Could not sweep chat worktrees', error),
      );
      if (!stopping.signal.aborted) await sleep();
    }
  })();
  return {
    exclusive,
    async stop() {
      stopping.abort();
      wakeUp?.();
      await loop;
    },
  };
}
