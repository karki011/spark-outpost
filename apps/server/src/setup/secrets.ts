import type { ConnectableId, TicketSourceId } from '@spark-outpost/contracts';
import type { Config } from '../config.ts';
import { keychainCache, nativeKeyring, type Keyring, type KeychainTiming } from './keychain.ts';

export type TicketSecretId = `ticket:${TicketSourceId}`;
export type SlackSecretId = 'slack:bot' | 'slack:user' | 'slack:app';
export const SLACK_SECRET_IDS: readonly SlackSecretId[] = ['slack:bot', 'slack:user', 'slack:app'];
export const SLACK_SIGN_IN_SECRET = 'slack:sign-in';
export const PUSH_KEYS_SECRET = 'remote:push';
export type GoogleCalendarSecretId = `calendar:google:${string}`;
export type MicrosoftCalendarSecretId = `calendar:microsoft:${string}`;
export const microsoftCalendarSecret = (subject: string): MicrosoftCalendarSecretId =>
  `calendar:microsoft:${subject}`;
export type McpOAuthSecretId = `mcp-oauth:${string}`;
export const mcpOAuthSecret = (serverId: string): McpOAuthSecretId => `mcp-oauth:${serverId}`;
export type ZoomSecretId = `zoom:${string}`;
export const zoomSecret = (subject: string): ZoomSecretId => `zoom:${subject}`;
export type ShareSecretId = `share:${string}`;
export const CLOUDFLARE_UPLOAD_KEY_SECRET = 'cloudflare:upload-key';
export const CLOUDFLARE_TUNNEL_TOKEN_SECRET = 'cloudflare:tunnel-token';
export const shareSecret = (shareId: string): ShareSecretId => `share:${shareId}`;
export const googleCalendarSecret = (subject: string): GoogleCalendarSecretId =>
  `calendar:google:${subject}`;
export type RemoteSparkSecretId = `remote-spark:${string}` | `remote-spark-access:${string}`;
export const remoteSparkSecret = (sparkId: string): RemoteSparkSecretId =>
  `remote-spark:${sparkId}`;
export const remoteSparkAccessSecret = (sparkId: string): RemoteSparkSecretId =>
  `remote-spark-access:${sparkId}`;
export type SecretId =
  | ConnectableId
  | 'github'
  | 'github-app'
  | TicketSecretId
  | SlackSecretId
  | typeof SLACK_SIGN_IN_SECRET
  | typeof PUSH_KEYS_SECRET
  | `mcp:${string}`
  | McpOAuthSecretId
  | `signin:${string}`
  | GoogleCalendarSecretId
  | MicrosoftCalendarSecretId
  | ZoomSecretId
  | ShareSecretId
  | typeof CLOUDFLARE_UPLOAD_KEY_SECRET
  | typeof CLOUDFLARE_TUNNEL_TOKEN_SECRET
  | RemoteSparkSecretId;

export interface SecretStore {
  set(provider: SecretId, secret: string): Promise<void>;
  get(provider: SecretId): Promise<string | null>;
  fresh(provider: SecretId): Promise<string | null>;
  delete(provider: SecretId): Promise<void>;
  waiting(): boolean;
}

export const DEFAULT_KEYCHAIN_SERVICE = 'Spark Outpost';

function account(provider: SecretId): string {
  if (provider.startsWith('mcp:') || provider.startsWith('signin:')) return provider;
  if (provider.startsWith('remote-spark:') || provider.startsWith('remote-spark-access:')) {
    return provider;
  }
  if (provider.startsWith('mcp-oauth:')) return `${provider}:sign-in`;
  if (provider.startsWith('calendar:google:') || provider.startsWith('calendar:microsoft:')) {
    return `${provider}:refresh`;
  }
  if (provider.startsWith('share:')) return `${provider}:delete`;
  if (provider === 'github') return 'github:token';
  if (provider === 'github-app') return 'github:app';
  if (provider === PUSH_KEYS_SECRET) return 'remote:push:vapid';
  if (provider.startsWith('ticket:') || provider.startsWith('slack:')) return `${provider}:token`;
  return `${provider}:api_key`;
}

export function keychainSecretStore(
  service = DEFAULT_KEYCHAIN_SERVICE,
  options: KeychainTiming & { keyring?: Keyring } = {},
): SecretStore {
  const keychain = keychainCache(options.keyring ?? nativeKeyring(service), options);
  return {
    set: (provider, secret) => keychain.set(account(provider), secret),
    get: (provider) => keychain.get(account(provider)),
    fresh: (provider) => keychain.fresh(account(provider)),
    delete: (provider) => keychain.delete(account(provider)),
    waiting: () => keychain.waiting(),
  };
}

export function memorySecretStore(seed: Partial<Record<SecretId, string>> = {}): SecretStore {
  const secrets = new Map(Object.entries(seed) as [SecretId, string][]);
  const read = async (provider: SecretId) => secrets.get(provider) ?? null;
  return {
    async set(provider, secret) {
      secrets.set(provider, secret);
    },
    get: read,
    fresh: read,
    async delete(provider) {
      secrets.delete(provider);
    },
    waiting: () => false,
  };
}

export function configuredSecretStore(
  config: Pick<Config, 'SECRET_STORE' | 'MEMORY_SECRETS' | 'KEYCHAIN_SERVICE'>,
): SecretStore {
  return config.SECRET_STORE === 'memory'
    ? memorySecretStore(config.MEMORY_SECRETS)
    : keychainSecretStore(config.KEYCHAIN_SERVICE);
}
