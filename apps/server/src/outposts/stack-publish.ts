import { prBase, type StackFacts, type StoryPullState } from '@spark-outpost/contracts';
import type { StackBase } from '../approvals/publish-policy.ts';
import type { ChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { ownerName } from './stack-base.ts';
import type { StackRepo } from './stack-git.ts';

export interface PublishStack {
  pullBase: string;
  stackBase: StackBase | null;
}

export const FALLBACK_DEFAULT_BRANCH = 'main';

interface ParentRow {
  parent_chat: string | null;
  handle: string | null;
  pr_state: StoryPullState | null;
}

async function branchOwner(db: Queryable, worktree: ChatWorktree): Promise<ParentRow | null> {
  const { rows } = await db.query<ParentRow>(
    `SELECT parent.conversation_id AS parent_chat, m.handle, pr.pr_state
     FROM outpost_story_tasks t
     JOIN LATERAL (
       SELECT p.conversation_id, p.branch FROM chat_worktrees p
       WHERE p.repo_root = $2 AND p.branch = $3 AND p.owns_branch AND p.id <> $4
       ORDER BY p.created_at DESC LIMIT 1
     ) parent ON true
     LEFT JOIN outpost_members m
       ON m.outpost_id = t.outpost_id AND m.conversation_id = parent.conversation_id
     LEFT JOIN LATERAL (
       SELECT w.pr_state FROM pr_watches w
       WHERE w.conversation_id = parent.conversation_id AND w.branch = parent.branch
       ORDER BY w.created_at DESC LIMIT 1
     ) pr ON true
     WHERE t.conversation_id = $1`,
    [worktree.conversationId, worktree.repoRoot, worktree.baseBranch, worktree.id],
  );
  return rows[0] ?? null;
}

function stackFacts(parent: ParentRow, parentBranch: string | null, defaultBranch: string) {
  return {
    handle: '',
    parentHandle: parent.handle ?? '',
    defaultBranch,
    branch: null,
    pull: null,
    parentBranch,
    parentOnRemote: true,
    parentInBranch: null,
    parentState: null,
    parentPull: parent.pr_state ? { state: parent.pr_state } : null,
  } satisfies StackFacts;
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
  const pullBase = prBase(stackFacts(parent, gone ? null : branch, fallback));
  if (pullBase !== branch) return { pullBase, stackBase: null };
  const onRemote = await git.branchOnRemote(repoRoot, branch).catch(() => true);
  return { pullBase, stackBase: { branch, owner: ownerName(parent.handle), onRemote } };
}
