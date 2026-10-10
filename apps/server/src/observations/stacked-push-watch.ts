import type { ApprovalRequest } from '../approvals/decide.ts';
import { isGitPush } from '../approvals/git-commands.ts';
import { stackedPushRefusal } from '../approvals/stacked-push.ts';
import type { Queryable } from '../persistence/db.ts';
import type { NewRailFlag } from '../persistence/rail-flags.ts';
import { taskBranch } from '../workflow/publish-context.ts';

export async function observedStackedPush(
  db: Queryable,
  request: ApprovalRequest,
): Promise<NewRailFlag | null> {
  if (!request.command || !isGitPush(request.command)) return null;
  const task = await taskBranch(db, request.roots[0]?.path ?? null).catch(() => null);
  const stack = task?.stackBase;
  if (!task || !stack || stackedPushRefusal(request.command, task) === null) return null;
  return {
    toolCallId: request.toolCallId,
    rail: 'stacked_push',
    paths: [`${task.branch} on ${stack.owner}'s ${stack.branch}`],
    inside: false,
    originals: [],
  };
}
