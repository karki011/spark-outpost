import {
  archivedOrDeleted,
  chatHasOpenRun,
  sweepableChatWorktrees,
  type ChatWorktree,
} from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { releaseChatWorktree, type ReleaseReason } from './chat-worktree-cleanup.ts';
import { branchMerged } from './chat-worktrees.ts';

const SWEEP_EVERY_MS = 60_000;
const REPOS_AT_ONCE = 4;

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
): Promise<void> {
  await exclusive(async () => {
    const chat = record.conversationId;
    if (chat && (await chatHasOpenRun(db, chat))) return;
    if (chat && reason === 'archived' && !(await archivedOrDeleted(db, chat))) return;
    await releaseChatWorktree(db, record, reason);
  });
}

async function sweepOne(db: Queryable, record: ChatWorktree, exclusive: Exclusive): Promise<void> {
  if (!record.conversationId) return releaseIdle(db, record, 'deleted', exclusive);
  if (await archivedOrDeleted(db, record.conversationId)) {
    return releaseIdle(db, record, 'archived', exclusive);
  }
  if (await branchMerged(record.repoRoot, record.branch, record.baseCommit)) {
    await releaseIdle(db, record, 'merged', exclusive);
  }
}

export async function sweepChatWorktrees(
  db: Queryable,
  exclusive: Exclusive,
  signal: AbortSignal,
): Promise<void> {
  const records = await sweepableChatWorktrees(db);
  await eachByRepo(records, REPOS_AT_ONCE, async (record) => {
    if (signal.aborted) return;
    await sweepOne(db, record, exclusive).catch((error: unknown) =>
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
