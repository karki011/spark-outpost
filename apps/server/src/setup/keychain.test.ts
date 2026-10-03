import { describe, expect, it } from 'vitest';
import { keychainCache, KeychainWaitingError, type Keyring } from './keychain.ts';

interface Pending {
  account: string;
  release: () => void;
}

function heldKeyring(seed: Record<string, string> = {}) {
  const stored = new Map(Object.entries(seed));
  const calls: string[] = [];
  const pending: Pending[] = [];
  let holding = true;
  const hold = (account: string) =>
    holding
      ? new Promise<void>((release) => pending.push({ account, release }))
      : Promise.resolve();
  const keyring: Keyring = {
    async get(account) {
      calls.push(`get ${account}`);
      await hold(account);
      return stored.get(account) ?? null;
    },
    async set(account, secret) {
      calls.push(`set ${account}`);
      await hold(account);
      stored.set(account, secret);
    },
    async delete(account) {
      calls.push(`delete ${account}`);
      await hold(account);
      stored.delete(account);
    },
  };
  return {
    keyring,
    calls,
    stored,
    releaseAll() {
      holding = false;
      for (const entry of pending.splice(0)) entry.release();
    },
    holdAgain() {
      holding = true;
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('keychain cache', () => {
  it('reads each key once for concurrent callers and serves later reads from memory', async () => {
    const fake = heldKeyring({ 'claude:api_key': 'sk-a' });
    const keychain = keychainCache(fake.keyring);
    const reads = [keychain.get('claude:api_key'), keychain.get('claude:api_key')];
    await tick();
    fake.releaseAll();
    expect(await Promise.all(reads)).toEqual(['sk-a', 'sk-a']);
    expect(await keychain.get('claude:api_key')).toBe('sk-a');
    expect(fake.calls).toEqual(['get claude:api_key']);
  });

  it('gives up waiting after the timeout with a keychain prompt hint, then fills the cache when access is allowed', async () => {
    const fake = heldKeyring({ 'claude:api_key': 'sk-a' });
    const keychain = keychainCache(fake.keyring, { timeoutMs: 20 });
    expect(keychain.waiting()).toBe(false);
    const error = await keychain.get('claude:api_key').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KeychainWaitingError);
    expect((error as Error).message).toMatch(/Waiting for macOS keychain access.*Always Allow/);
    expect(keychain.waiting()).toBe(true);

    fake.releaseAll();
    await tick();
    expect(keychain.waiting()).toBe(false);
    expect(await keychain.get('claude:api_key')).toBe('sk-a');
    expect(fake.calls).toEqual(['get claude:api_key']);
  });

  it('runs one keychain call at a time so a held prompt never ties up more than one thread', async () => {
    const fake = heldKeyring();
    const keychain = keychainCache(fake.keyring, { timeoutMs: 20 });
    const read = keychain.get('codex:api_key').catch(() => null);
    const write = keychain.set('github:token', 'ghp').catch((caught: unknown) => caught);
    await tick();
    expect(fake.calls).toEqual(['get codex:api_key']);
    expect(await write).toBeInstanceOf(KeychainWaitingError);
    await read;
    fake.releaseAll();
    await tick();
    await tick();
    expect(fake.calls).toEqual(['get codex:api_key', 'set github:token']);
    expect(fake.stored.get('github:token')).toBe('ghp');
    expect(await keychain.get('github:token')).toBe('ghp');
  });

  it('keeps serving the last value while a refresh waits on a keychain prompt', async () => {
    let clock = 0;
    const fake = heldKeyring({ 'jev:api_key': 'jk' });
    const keychain = keychainCache(fake.keyring, { timeoutMs: 20, freshMs: 100, now: () => clock });
    const first = keychain.get('jev:api_key');
    await tick();
    fake.releaseAll();
    expect(await first).toBe('jk');

    fake.stored.set('jev:api_key', 'jk2');
    fake.holdAgain();
    clock = 500;
    expect(await keychain.get('jev:api_key')).toBe('jk');
    expect(keychain.waiting()).toBe(true);
    expect(await keychain.get('jev:api_key')).toBe('jk');
    expect(fake.calls).toEqual(['get jev:api_key', 'get jev:api_key']);

    fake.releaseAll();
    await tick();
    expect(keychain.waiting()).toBe(false);
    expect(await keychain.get('jev:api_key')).toBe('jk2');
  });

  it('remembers writes and deletes without reading the keychain back', async () => {
    const fake = heldKeyring();
    fake.releaseAll();
    const keychain = keychainCache(fake.keyring);
    await keychain.set('zai:api_key', 'z1');
    expect(await keychain.get('zai:api_key')).toBe('z1');
    await keychain.delete('zai:api_key');
    expect(await keychain.get('zai:api_key')).toBeNull();
    expect(fake.calls).toEqual(['set zai:api_key', 'delete zai:api_key']);
  });
});
