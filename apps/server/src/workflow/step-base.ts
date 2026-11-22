import type { BaseUpdate } from '../approvals/base-update.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { defaultBranch } from '../projects/chat-worktrees.ts';
import { git } from '../projects/snapshot.ts';
import { stackGit } from '../sub-chats/stack-git.ts';
import { publishStackOf } from '../sub-chats/stack-publish.ts';

async function onRemote(root: string, branch: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}^{commit}`]);
    return true;
  } catch {
    return false;
  }
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
  return { base, rebase: !(await onRemote(root, record.branch)) };
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
