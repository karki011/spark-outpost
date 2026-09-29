import { Entry } from '@napi-rs/keyring';
import type { ConnectableId, TicketSourceId } from '@spark-outpost/contracts';
import type { Config } from '../config.ts';

export type TicketSecretId = `ticket:${TicketSourceId}`;
export type SecretId = ConnectableId | 'github' | TicketSecretId | `mcp:${string}`;

export interface SecretStore {
  set(provider: SecretId, secret: string): Promise<void>;
  get(provider: SecretId): Promise<string | null>;
  delete(provider: SecretId): Promise<void>;
}

export const DEFAULT_KEYCHAIN_SERVICE = 'Spark Outpost';

function account(provider: SecretId): string {
  if (provider.startsWith('mcp:')) return provider;
  if (provider === 'github') return 'github:token';
  if (provider.startsWith('ticket:')) return `${provider}:token`;
  return `${provider}:api_key`;
}

export function keychainSecretStore(service = DEFAULT_KEYCHAIN_SERVICE): SecretStore {
  const entry = (provider: SecretId) => new Entry(service, account(provider));
  return {
    async set(provider, secret) {
      entry(provider).setPassword(secret);
    },
    async get(provider) {
      return entry(provider).getPassword();
    },
    async delete(provider) {
      entry(provider).deletePassword();
    },
  };
}

export function memorySecretStore(seed: Partial<Record<SecretId, string>> = {}): SecretStore {
  const secrets = new Map(Object.entries(seed) as [SecretId, string][]);
  return {
    async set(provider, secret) {
      secrets.set(provider, secret);
    },
    async get(provider) {
      return secrets.get(provider) ?? null;
    },
    async delete(provider) {
      secrets.delete(provider);
    },
  };
}

export function configuredSecretStore(
  config: Pick<Config, 'SECRET_STORE' | 'MEMORY_SECRETS' | 'KEYCHAIN_SERVICE'>,
): SecretStore {
  return config.SECRET_STORE === 'memory'
    ? memorySecretStore(config.MEMORY_SECRETS)
    : keychainSecretStore(config.KEYCHAIN_SERVICE);
}
