import { stringMap } from '../agent-config/records.ts';
import type { SecretStore } from '../setup/secrets.ts';

export interface McpSecretValues {
  env: Record<string, string>;
  headers: Record<string, string>;
}

const EMPTY_SECRETS: McpSecretValues = { env: {}, headers: {} };

const secretId = (serverId: string) => `mcp:${serverId}` as const;

export async function readMcpSecrets(
  store: Pick<SecretStore, 'get'> | undefined,
  serverId: string,
): Promise<McpSecretValues> {
  const raw = await store?.get(secretId(serverId)).catch(() => null);
  if (!raw) return EMPTY_SECRETS;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { env: stringMap(parsed.env), headers: stringMap(parsed.headers) };
  } catch {
    return EMPTY_SECRETS;
  }
}

export function secretNames(values: McpSecretValues): string[] {
  return [...new Set([...Object.keys(values.env), ...Object.keys(values.headers)])].sort();
}

export async function writeMcpSecrets(
  store: SecretStore,
  serverId: string,
  values: McpSecretValues,
): Promise<void> {
  if (secretNames(values).length === 0) {
    await deleteMcpSecrets(store, serverId);
    return;
  }
  await store.set(secretId(serverId), JSON.stringify(values));
}

export async function deleteMcpSecrets(store: SecretStore, serverId: string): Promise<void> {
  await store.delete(secretId(serverId)).catch(() => undefined);
}

export function mergeSecrets(current: McpSecretValues, added: McpSecretValues): McpSecretValues {
  return {
    env: { ...current.env, ...added.env },
    headers: { ...current.headers, ...added.headers },
  };
}

export function keepNames(
  values: McpSecretValues,
  envNames: readonly string[],
  headerNames: readonly string[],
): McpSecretValues {
  const pick = (map: Record<string, string>, names: readonly string[]) =>
    Object.fromEntries(Object.entries(map).filter(([name]) => names.includes(name)));
  return { env: pick(values.env, envNames), headers: pick(values.headers, headerNames) };
}
