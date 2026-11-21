import { prBase, type SubChatPullState } from '@spark-outpost/contracts';
import type { StackBase } from '../approvals/publish-policy.ts';
import type { ChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { stackOwner } from './stack-base.ts';
import type { StackRepo } from './stack-git.ts';

export interface PublishStack {
  pullBase: string;
  stackBase: StackBase | null;
}

export const FALLBACK_DEFAULT_BRANCH = 'main';

interface ParentRow {
  parent_chat: string | null;
  title: string | null;
  pr_state: SubChatPullState | null;
}

async function branchOwner(db: Queryable, worktree: ChatWorktree): Promise<ParentRow | null> {
  const { rows } = await db.query<ParentRow>(
    `SELECT CASE WHEN owner.conversation_id = s.stacked_on THEN owner.conversation_id END
         AS parent_chat, c.title, pr.pr_state
     FROM sub_chats s
     JOIN LATERAL (
       SELECT p.conversation_id, p.branch FROM chat_worktrees p
       WHERE p.repo_root = $2 AND p.branch = $3 AND p.owns_branch AND p.id <> $4
       ORDER BY (p.conversation_id = s.stacked_on) DESC NULLS LAST, p.created_at DESC LIMIT 1
     ) owner ON true
     LEFT JOIN conversations c ON c.id = owner.conversation_id
     LEFT JOIN LATERAL (
       SELECT w.pr_state FROM pr_watches w
       WHERE w.conversation_id = owner.conversation_id AND w.branch = owner.branch
       ORDER BY w.created_at DESC LIMIT 1
     ) pr ON true
     WHERE s.conversation_id = $1`,
    [worktree.conversationId, worktree.repoRoot, worktree.baseBranch, worktree.id],
  );
  return rows[0] ?? null;
}

function pullBaseOf(parent: ParentRow, parentBranch: string | null, defaultBranch: string) {
  return prBase({
    handle: '',
    parentHandle: parent.title ?? '',
    defaultBranch,
    branch: null,
    pull: null,
    parentBranch,
    parentOnRemote: true,
    parentInBranch: null,
    parentState: null,
    parentPull: parent.pr_state ? { state: parent.pr_state } : null,
  });
}

export async function publishStackOf(
  db: Queryable,
  git: StackRepo,
  worktree: ChatWorktree,
): Promise<PublishStack | null> {
  const branch = worktree.baseBranch;
  if (!worktree.ownsBranch || !worktree.conversationId || !branch) return null;
  const parent = await branchOwner(db, worktree);
  if (!parent) return null;
  const { repoRoot } = worktree;
  const gone = parent.parent_chat === null || !(await git.hasBranch(repoRoot, branch));
  const fallback = (await git.defaultBranch(repoRoot)) ?? FALLBACK_DEFAULT_BRANCH;
  const pullBase = pullBaseOf(parent, gone ? null : branch, fallback);
  if (pullBase !== branch) return { pullBase, stackBase: null };
  const onRemote = await git.branchOnRemote(repoRoot, branch).catch(() => true);
  return { pullBase, stackBase: { branch, owner: stackOwner(parent.title ?? ''), onRemote } };
}
