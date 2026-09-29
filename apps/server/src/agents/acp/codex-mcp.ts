import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { isRecord } from '../../agent-config/records.ts';

function codexConfigPath(env: Readonly<Record<string, string | undefined>>): string {
  const home = env.CODEX_HOME || join(env.HOME || homedir(), '.codex');
  return join(home, 'config.toml');
}

function codexServerTable(text: string): Record<string, unknown> | null {
  try {
    const parsed = parseToml(text);
    return isRecord(parsed.mcp_servers) ? parsed.mcp_servers : {};
  } catch {
    return null;
  }
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
