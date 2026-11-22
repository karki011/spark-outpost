import type { BaseUpdate } from '../approvals/base-update.ts';
import { branchesStackedOn, chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { defaultBranch } from '../projects/chat-worktrees.ts';
import { git } from '../projects/snapshot.ts';
import { stackGit } from '../sub-chats/stack-git.ts';
import { publishStackOf } from '../sub-chats/stack-publish.ts';
import { taskBranch } from './publish-context.ts';

async function onRemote(root: string, branch: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function shared(db: Queryable, root: string, branch: string): Promise<boolean> {
  const task = await taskBranch(db, root).catch(() => null);
  if (task?.pull || task?.adopted) return true;
  if ((await branchesStackedOn(db, root)).length > 0) return true;
  return onRemote(root, branch);
}

export async function stepBaseUpdate(
  db: Queryable,
  root: string | null,
): Promise<BaseUpdate | null> {
  if (!root) return null;
  const record = await chatWorktreeAt(db, root);
  if (!record?.ownsBranch) return null;
  const stack = await publishStackOf(db, stackGit, record).catch(() => null);
  const base =
    stack?.pullBase ??
    record.baseBranch ??
    (await defaultBranch(record.repoRoot).catch(() => null));
  if (!base || base === record.branch) return null;
  return { base, rebase: !(await shared(db, root, record.branch)) };
}

export async function chatBaseUpdate(
  db: Queryable,
  conversationId: string,
): Promise<BaseUpdate | null> {
  const { rows } = await db.query<{ path: string }>(
    `SELECT path FROM chat_worktrees
     WHERE conversation_id = $1 AND removed_at IS NULL AND NOT in_place
     ORDER BY created_at LIMIT 1`,
    [conversationId],
  );
  return stepBaseUpdate(db, rows[0]?.path ?? null);
}
