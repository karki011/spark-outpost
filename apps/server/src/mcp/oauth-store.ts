import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpSignInState } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { mcpOAuthSecret, type SecretStore } from '../setup/secrets.ts';

export interface SavedSignIn {
  url: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  discovery?: OAuthDiscoveryState;
  expiresAt: number | null;
}

function parsed(raw: string | null): SavedSignIn | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedSignIn> | null;
    if (!value || typeof value.url !== 'string') return null;
    return { ...value, url: value.url, expiresAt: value.expiresAt ?? null };
  } catch {
    return null;
  }
}

export async function readSignIn(
  secrets: Pick<SecretStore, 'get' | 'fresh'>,
  serverId: string,
  options: { fresh?: boolean } = {},
): Promise<SavedSignIn | null> {
  const id = mcpOAuthSecret(serverId);
  const raw = await (options.fresh ? secrets.fresh(id) : secrets.get(id)).catch(() => null);
  return parsed(raw);
}

export async function writeSignIn(
  secrets: SecretStore,
  serverId: string,
  saved: SavedSignIn,
): Promise<void> {
  await secrets.set(mcpOAuthSecret(serverId), JSON.stringify(saved));
}

export async function deleteSignIn(secrets: SecretStore, serverId: string): Promise<void> {
  await secrets.delete(mcpOAuthSecret(serverId)).catch(() => undefined);
}

export async function markSignIn(
  db: Queryable,
  serverId: string,
  state: McpSignInState,
): Promise<void> {
  await db.query('UPDATE mcp_servers SET sign_in = $2 WHERE id = $1', [serverId, state]);
}
