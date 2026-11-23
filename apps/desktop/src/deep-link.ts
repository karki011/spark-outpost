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
