export function linkIn(argv: readonly string[], scheme: string): string | null {
  return argv.find((argument) => argument.startsWith(`${scheme}://`)) ?? null;
}

export function launchLink(
  argv: readonly string[],
  scheme: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  return platform === 'win32' ? linkIn(argv, scheme) : null;
}
