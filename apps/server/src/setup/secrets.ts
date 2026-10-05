import type { ConnectableId, TicketSourceId } from '@spark-outpost/contracts';
import type { Config } from '../config.ts';
import { keychainCache, nativeKeyring, type Keyring, type KeychainTiming } from './keychain.ts';

export type TicketSecretId = `ticket:${TicketSourceId}`;
export type SlackSecretId = 'slack:bot' | 'slack:user' | 'slack:app';
export const SLACK_SECRET_IDS: readonly SlackSecretId[] = ['slack:bot', 'slack:user', 'slack:app'];
export type SecretId =
  | ConnectableId
  | 'github'
  | 'github-app'
  | TicketSecretId
  | SlackSecretId
  | `mcp:${string}`
  | `signin:${string}`;

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
  if (provider === 'github') return 'github:token';
  if (provider === 'github-app') return 'github:app';
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
