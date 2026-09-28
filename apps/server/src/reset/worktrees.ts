import { rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { git } from '../projects/snapshot.ts';
import { RESULT_REF_PREFIX, WORKTREES_DIR, worktreePath } from '../projects/worktrees.ts';
import type { Queryable } from '../persistence/db.ts';

export interface OwnedWorktree {
  runId: string;
  repoRoot: string;
  branch: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ownedWorktrees(db: Queryable): Promise<OwnedWorktree[]> {
  const { rows } = await db.query<{ run_id: string; repo_root: string; branch: string }>(
    'SELECT run_id, repo_root, branch FROM run_worktrees WHERE removed_at IS NULL ORDER BY created_at',
  );
  return rows.map((row) => ({ runId: row.run_id, repoRoot: row.repo_root, branch: row.branch }));
}

async function succeeds(root: string, args: string[]): Promise<boolean> {
  try {
    await git(root, args);
    return true;
  } catch {
    return false;
  }
}

async function wasPushed(root: string, branch: string): Promise<boolean> {
  if (await succeeds(root, ['rev-parse', '--verify', '-q', `${branch}@{upstream}`])) return true;
  const remotes = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes']).catch(
    () => '',
  );
  return remotes.split('\n').some((ref) => ref.endsWith(`/${branch}`));
}

async function deleteLocalBranch(root: string, branch: string): Promise<void> {
  if (!(await succeeds(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]))) return;
  if (await wasPushed(root, branch)) return;
  await git(root, ['branch', '-D', branch]);
}

export async function removeOwnedWorktree(worktree: OwnedWorktree): Promise<void> {
  if (!UUID.test(worktree.runId)) throw new Error('The worktree record has an unexpected id.');
  const target = worktreePath(worktree.repoRoot, worktree.runId);
  await git(worktree.repoRoot, ['worktree', 'remove', '--force', target]).catch(() => undefined);
  await rm(target, { recursive: true, force: true });
  await git(worktree.repoRoot, ['worktree', 'prune']).catch(() => undefined);
  await rmdir(path.join(worktree.repoRoot, WORKTREES_DIR)).catch(() => undefined);
  await git(worktree.repoRoot, ['update-ref', '-d', `${RESULT_REF_PREFIX}${worktree.runId}`]).catch(
    () => undefined,
  );
  await deleteLocalBranch(worktree.repoRoot, worktree.branch);
}
