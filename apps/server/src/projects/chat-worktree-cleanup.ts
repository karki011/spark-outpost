import { access } from 'node:fs/promises';
import {
  archivedOrDeleted,
  chatWorktreesOf,
  markChatWorktreeKeptDirty,
  markChatWorktreeRemoved,
  sweepableChatWorktrees,
  type ChatWorktree,
} from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import {
  branchMerged,
  branchSafeToDelete,
  changedFiles,
  deleteBranch,
  removeWorktreeDir,
  saveWorktreeWork,
} from './chat-worktrees.ts';
import { worktreePath } from './worktrees.ts';

export type ReleaseReason = 'deleted' | 'archived' | 'merged' | 'reset';

export interface Released {
  removed: boolean;
  branchKept: boolean;
  saved: boolean;
}

const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

async function present(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

const KEEP_DIRTY: ReadonlySet<ReleaseReason> = new Set(['archived', 'merged']);

export async function releaseOnDisk(
  record: ChatWorktree,
  reason: ReleaseReason,
): Promise<Released> {
  if (record.inPlace) return { removed: true, branchKept: true, saved: false };
  const exists = await present(record.path);
  const dirty = exists ? (await changedFiles(record.path)).length > 0 : false;
  if (dirty && KEEP_DIRTY.has(reason)) return { removed: false, branchKept: true, saved: false };
  if (dirty) {
    await saveWorktreeWork(
      record.path,
      record.branch,
      `Spark Outpost: saved work (chat ${reason})`,
    );
  }
  await removeWorktreeDir(record.repoRoot, worktreePath(record.repoRoot, record.id));
  const deletable =
    record.ownsBranch &&
    !record.adopted?.pushes &&
    (await branchSafeToDelete(record.repoRoot, record.branch, record.baseCommit));
  if (deletable) await deleteBranch(record.repoRoot, record.branch);
  return { removed: true, branchKept: !deletable, saved: dirty };
}

export async function releaseChatWorktree(
  db: Queryable,
  record: ChatWorktree,
  reason: ReleaseReason,
): Promise<Released> {
  const released = await releaseOnDisk(record, reason);
  if (released.removed) await markChatWorktreeRemoved(db, record.id);
  else if (reason === 'archived') await markChatWorktreeKeptDirty(db, record.id);
  return released;
}

export async function releaseConversation(
  db: Queryable,
  conversationId: string,
  reason: ReleaseReason,
): Promise<Released[]> {
  const released: Released[] = [];
  for (const record of await chatWorktreesOf(db, conversationId)) {
    try {
      released.push(await releaseChatWorktree(db, record, reason));
    } catch (error) {
      console.error(`Could not release the worktree on ${record.branch}`, error);
    }
  }
  return released;
}

async function sweepOne(db: Queryable, record: ChatWorktree): Promise<void> {
  if (!record.conversationId) {
    await releaseChatWorktree(db, record, 'deleted');
    return;
  }
  if (await archivedOrDeleted(db, record.conversationId)) {
    await releaseChatWorktree(db, record, 'archived');
    return;
  }
  if (await branchMerged(record.repoRoot, record.branch, record.baseCommit)) {
    await releaseChatWorktree(db, record, 'merged');
  }
}

export async function sweepChatWorktrees(db: Queryable, now = Date.now()): Promise<void> {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const record of await sweepableChatWorktrees(db)) {
    await sweepOne(db, record).catch((error: unknown) =>
      console.error(`Could not sweep the worktree on ${record.branch}`, error),
    );
  }
}
