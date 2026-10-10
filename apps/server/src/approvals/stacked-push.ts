import { pushTargets } from './git-commands.ts';
import { parentNotPushedReason, type TaskBranch } from './publish-policy.ts';

export function pushesBranch(command: string, branch: string): boolean {
  return pushTargets(command).some(
    (push) => !push.widens && (push.branches.length === 0 || push.branches.includes(branch)),
  );
}

export function stackedPushRefusal(command: string, task: TaskBranch | null): string | null {
  const stack = task?.stackBase;
  if (!task || !stack || stack.onRemote || !pushesBranch(command, task.branch)) return null;
  return parentNotPushedReason(task.branch, stack);
}
