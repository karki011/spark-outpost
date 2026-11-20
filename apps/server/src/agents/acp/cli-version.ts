import { stat } from 'node:fs/promises';
import { runCommand, type RunCommand } from '../../setup/command.ts';

export const CLAUDE_MCP_STDIN_FROM = '2.1.326';

const VERSION_TIMEOUT_MS = 10_000;
const versions = new Map<string, Promise<string | null>>();

function parts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

export function atLeast(version: string, minimum: string): boolean {
  const have = parts(version);
  const need = parts(minimum);
  for (let index = 0; index < need.length; index += 1) {
    const difference = (have[index] ?? 0) - (need[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

async function installedAt(path: string): Promise<string> {
  return stat(path).then(
    (found) => String(found.mtimeMs),
    () => 'missing',
  );
}

export async function cliVersion(
  path: string,
  run: RunCommand = runCommand,
): Promise<string | null> {
  const key = `${path}\0${await installedAt(path)}`;
  const known = versions.get(key);
  if (known) return known;
  const found = run(path, ['--version'], VERSION_TIMEOUT_MS).then(
    (result) => (result.code === 0 ? (result.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null) : null),
    () => null,
  );
  versions.set(key, found);
  return found;
}

export async function claudeReadsMcpOverStdin(
  cli: Record<string, string>,
  run: RunCommand = runCommand,
): Promise<boolean> {
  const path = cli.CLAUDE_CODE_EXECUTABLE;
  if (!path) return false;
  const version = await cliVersion(path, run);
  return version !== null && atLeast(version, CLAUDE_MCP_STDIN_FROM);
}
