import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { codexServerTable } from '../../mcp/sources.ts';

export function codexConfigPath(env: Readonly<Record<string, string | undefined>>): string {
  const home = env.CODEX_HOME || join(env.HOME || homedir(), '.codex');
  return join(home, 'config.toml');
}

export async function codexUserMcpNames(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string[]> {
  const text = await readFile(codexConfigPath(env), 'utf8').catch(() => null);
  if (text === null) return [];
  return Object.keys(codexServerTable(text) ?? {}).sort();
}

export function disabledCodexServers(names: readonly string[]): Record<string, object> {
  return Object.fromEntries(names.map((name) => [name, { enabled: false }]));
}
