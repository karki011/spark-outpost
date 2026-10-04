export function linkIn(argv: readonly string[], scheme: string): string | null {
  return argv.find((argument) => argument.startsWith(`${scheme}://`)) ?? null;
}
