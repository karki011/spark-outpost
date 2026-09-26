import { Entry } from '@napi-rs/keyring';
import type { ConnectableId } from '@spark-outpost/contracts';

export interface SecretStore {
  set(provider: ConnectableId, secret: string): Promise<void>;
  get(provider: ConnectableId): Promise<string | null>;
  delete(provider: ConnectableId): Promise<void>;
}

const KEYCHAIN_SERVICE = 'Spark Outpost';

const account = (provider: ConnectableId) => `${provider}:api_key`;

export function keychainSecretStore(): SecretStore {
  const entry = (provider: ConnectableId) => new Entry(KEYCHAIN_SERVICE, account(provider));
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

export function memorySecretStore(seed: Partial<Record<ConnectableId, string>> = {}): SecretStore {
  const secrets = new Map(Object.entries(seed) as [ConnectableId, string][]);
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
