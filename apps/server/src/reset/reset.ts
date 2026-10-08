import type { ResetReport } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { SecretId, SecretStore } from '../setup/secrets.ts';
import { storedSecretIds } from './secrets.ts';
import { stopActiveWork } from './stop-work.ts';
import { wipeAppData } from './wipe.ts';
import { allLiveChatWorktrees, type ChatWorktree } from '../persistence/chat-worktrees.ts';
import { releaseOnDisk } from '../projects/chat-worktree-cleanup.ts';
import { ownedWorktrees, removeOwnedWorktree, type OwnedWorktree } from './worktrees.ts';

export const RUN_SETTLE_MS = 5000;

export interface ResetDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  stopTerminals: () => void | Promise<void>;
  settleMs?: number;
}

async function removeSecret(secrets: SecretStore, id: SecretId): Promise<boolean> {
  if ((await secrets.get(id)) === null) return false;
  await secrets.delete(id);
  return true;
}

async function removeSecrets(secrets: SecretStore, ids: readonly SecretId[], problems: string[]) {
  let removed = 0;
  for (const id of ids) {
    try {
      if (await removeSecret(secrets, id)) removed += 1;
    } catch {
      problems.push(`Couldn't remove the saved ${id} secret from the keychain.`);
    }
  }
  return removed;
}

async function removeWorktrees(worktrees: readonly OwnedWorktree[], problems: string[]) {
  let removed = 0;
  for (const worktree of worktrees) {
    try {
      await removeOwnedWorktree(worktree);
      removed += 1;
    } catch {
      problems.push(`Couldn't fully remove the ${worktree.branch} copy in ${worktree.repoRoot}.`);
    }
  }
  return removed;
}

async function removeChatCopies(copies: readonly ChatWorktree[], problems: string[]) {
  let removed = 0;
  for (const copy of copies) {
    try {
      const released = await releaseOnDisk(copy, 'reset');
      if (released.removed) removed += 1;
      if (released.saved) problems.push(`Saved uncommitted chat work on ${copy.branch}.`);
    } catch {
      problems.push(`Couldn't fully remove the ${copy.branch} worktree in ${copy.repoRoot}.`);
    }
  }
  return removed;
}

export async function resetSparkOutpost(
  deps: ResetDeps,
  { keepApiKeys }: { keepApiKeys: boolean },
): Promise<ResetReport> {
  const problems: string[] = [];
  await deps.stopTerminals();
  const stillRunning = await stopActiveWork(deps.db, deps.settleMs ?? RUN_SETTLE_MS);
  if (stillRunning > 0) problems.push(`${stillRunning} agent runs were still stopping.`);
  const secretIds = await storedSecretIds(deps.db, keepApiKeys);
  const worktrees = await ownedWorktrees(deps.db);
  const chatCopies = await allLiveChatWorktrees(deps.db);
  await wipeAppData(deps.db, deps.workspaceId);
  const secretsRemoved = await removeSecrets(deps.secrets, secretIds, problems);
  const worktreesRemoved =
    (await removeWorktrees(worktrees, problems)) + (await removeChatCopies(chatCopies, problems));
  return { secretsRemoved, worktreesRemoved, problems };
}
