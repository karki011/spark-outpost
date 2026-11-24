import { parseSparkChatLink } from '@spark-outpost/contracts';

export function linkIn(argv: readonly string[], scheme: string): string | null {
  return argv.find((argument) => argument.startsWith(`${scheme}://`)) ?? null;
}

export function launchChat(
  argv: readonly string[],
  scheme: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const link = platform === 'win32' ? linkIn(argv, scheme) : null;
  return link ? parseSparkChatLink(link, scheme) : null;
}

export type JumpTask = 'show-island' | 'hide-island' | 'lock';

const JUMP_TASKS: readonly JumpTask[] = ['show-island', 'hide-island', 'lock'];
export const JUMP_TASK_FLAG = '--spark-task=';

export function jumpTaskIn(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): JumpTask | null {
  if (platform !== 'win32') return null;
  const flagged = argv.find((argument) => argument.startsWith(JUMP_TASK_FLAG));
  const value = flagged?.slice(JUMP_TASK_FLAG.length);
  return JUMP_TASKS.find((task) => task === value) ?? null;
}
