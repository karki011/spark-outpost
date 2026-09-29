import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultHomes } from '../../mcp/scan.ts';
import { codexServerTable } from '../../mcp/sources.ts';

function codexConfigPath(env: Readonly<Record<string, string | undefined>>): string {
  return join(defaultHomes(env).codexHome, 'config.toml');
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
