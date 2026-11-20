import { access } from 'node:fs/promises';
import {
  chatWorktreesOf,
  markChatWorktreeKeptDirty,
  markChatWorktreeRemoved,
  type ChatWorktree,
} from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { folderInUse } from '../persistence/folder-in-use.ts';
import {
  branchSafeToDelete,
  changedFiles,
  deleteBranch,
  removeWorktreeDir,
  saveWorktreeWork,
} from './chat-worktrees.ts';
import { ignoredFilesThatMatter } from './worktree-ignored.ts';
import { worktreePath } from './worktrees.ts';

export type ReleaseReason = 'deleted' | 'archived' | 'merged' | 'reset';

export interface Released {
  removed: boolean;
  branchKept: boolean;
  saved: boolean;
  ignoredKept: string[];
  inUse: boolean;
}

async function present(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

const KEEP_DIRTY: ReadonlySet<ReleaseReason> = new Set(['archived', 'merged']);
const NAMED_FILES = 5;

function kept(ignoredKept: string[], inUse = false): Released {
  return { removed: false, branchKept: true, saved: false, ignoredKept, inUse };
}

export async function releaseOnDisk(
  record: ChatWorktree,
  reason: ReleaseReason,
): Promise<Released> {
  if (record.inPlace) {
    return { removed: true, branchKept: true, saved: false, ignoredKept: [], inUse: false };
  }
  const exists = await present(record.path);
  const dirty = exists ? (await changedFiles(record.path)).length > 0 : false;
  const ignored = exists ? await ignoredFilesThatMatter(record.path) : [];
  if (ignored.length > 0) return kept(ignored);
  if (dirty && KEEP_DIRTY.has(reason)) return kept([]);
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
  return { removed: true, branchKept: !deletable, saved: dirty, ignoredKept: [], inUse: false };
}

export function keptIgnoredNote(record: ChatWorktree, released: Released): string | null {
  const files = released.ignoredKept;
  if (files.length === 0) return null;
  const more = files.length > NAMED_FILES ? ` and ${files.length - NAMED_FILES} more` : '';
  const named = files.slice(0, NAMED_FILES).join(', ');
  return `Kept the ${record.branch} worktree at ${record.path}: it holds files git ignores (${named}${more}).`;
}

export async function releaseChatWorktree(
  db: Queryable,
  record: ChatWorktree,
  reason: ReleaseReason,
): Promise<Released> {
  if (!record.inPlace && (await folderInUse(db, record.path))) return kept([], true);
  const released = await releaseOnDisk(record, reason);
  if (released.removed) await markChatWorktreeRemoved(db, record.id);
  else if (reason !== 'merged') await markChatWorktreeKeptDirty(db, record.id);
  const note = keptIgnoredNote(record, released);
  if (note) console.log(note);
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
