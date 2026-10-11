import type { StackBase } from '../approvals/publish-policy.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import type { Db } from '../persistence/db.ts';
import { pickRemote } from '../ship/git.ts';
import { publishScope } from '../workflow/publish-context.ts';
import type { RunInput } from '../workflow/run-input.ts';

export const NO_OWN_BRANCH_LINE =
  'Not published: this chat has no branch of its own with a remote to push to (it works in your checkout, or the folder has no remote). Use Ship in the Work panel’s Changes tab instead.';

export interface PublishPlan {
  root: string;
  branch: string;
  base: string | null;
  pullBase: string | null;
  stackBase: StackBase | null;
}

export function parentNotPushedLine(stack: Pick<StackBase, 'branch' | 'owner'>): string {
  return `Not published: this chat's branch is built on ${stack.owner}'s branch ${stack.branch}, which is not on the remote yet.\n\nNeeds you: ${stack.owner}'s branch is not pushed.`;
}

export async function agentPublishPlan(place: {
  db: Db;
  input: RunInput;
}): Promise<PublishPlan | null> {
  const scope = await publishScope(place.db, place.input);
  if (!scope || scope.task.protectedBranches.includes(scope.task.branch)) return null;
  if (!(await pickRemote(scope.root, scope.task.branch))) return null;
  const worktree = await chatWorktreeAt(place.db, scope.root);
  const { branch, pullBase = null, stackBase = null } = scope.task;
  const base = pullBase ?? worktree?.baseBranch ?? null;
  return { root: scope.root, branch, base, pullBase, stackBase };
}
