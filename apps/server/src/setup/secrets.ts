import { Entry } from '@napi-rs/keyring';
import type { ConnectableId } from '@spark-outpost/contracts';

export type SecretId = ConnectableId | 'github' | `mcp:${string}`;

export interface SecretStore {
  set(provider: SecretId, secret: string): Promise<void>;
  get(provider: SecretId): Promise<string | null>;
  delete(provider: SecretId): Promise<void>;
}

export const DEFAULT_KEYCHAIN_SERVICE = 'Spark Outpost';

const account = (provider: SecretId) => {
  if (provider.startsWith('mcp:')) return provider;
  return provider === 'github' ? 'github:token' : `${provider}:api_key`;
};

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
