import { describe, expect, it } from 'vitest';
import type { Keyring } from './keychain.ts';
import { chunkedKeyring, splitSecret } from './keyring-chunks.ts';

function memory(limit = 1280): Keyring & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    async get(account) {
      return entries.get(account) ?? null;
    },
    async set(account, secret) {
      if (secret.length > limit) throw new Error('longer than the platform allows');
      entries.set(account, secret);
    },
    async delete(account) {
      entries.delete(account);
    },
  };
}

describe('secrets larger than Windows Credential Manager holds', () => {
  it('keeps a short secret in one entry, as before', async () => {
    const inner = memory();
    const keyring = chunkedKeyring(inner);
    await keyring.set('token', 'abc');
    expect([...inner.entries]).toEqual([['token', 'abc']]);
    expect(await keyring.get('token')).toBe('abc');
  });

  it('splits a long secret into parts and reads it back whole', async () => {
    const inner = memory();
    const keyring = chunkedKeyring(inner);
    const secret = 'x'.repeat(5000);
    await keyring.set('telemetry:headers', secret);
    expect(inner.entries.size).toBe(6);
    expect(await keyring.get('telemetry:headers')).toBe(secret);
  });

  it('removes parts left over when the secret gets shorter or is deleted', async () => {
    const inner = memory();
    const keyring = chunkedKeyring(inner);
    await keyring.set('a', 'y'.repeat(3500));
    await keyring.set('a', 'z'.repeat(1500));
    expect([...inner.entries.keys()].sort()).toEqual(['a', 'a#chunk-1', 'a#chunk-2']);
    await keyring.set('a', 'short');
    expect([...inner.entries.keys()]).toEqual(['a']);
    await keyring.set('a', 'w'.repeat(2500));
    await keyring.delete('a');
    expect(inner.entries.size).toBe(0);
  });

  it('never reads a secret that looks like the part marker as parts', async () => {
    const keyring = chunkedKeyring(memory());
    await keyring.set('a', 'spark-chunks:v1:2');
    expect(await keyring.get('a')).toBe('spark-chunks:v1:2');
  });

  it('fails loudly when a part is missing', async () => {
    const inner = memory();
    const keyring = chunkedKeyring(inner);
    await keyring.set('a', 'q'.repeat(2500));
    inner.entries.delete('a#chunk-2');
    await expect(keyring.get('a')).rejects.toThrow('Part 2 of 3');
  });

  it('never splits a character made of two halves', () => {
    const parts = splitSecret(`${'a'.repeat(999)}😀b`, 1000);
    expect(parts).toEqual(['a'.repeat(999), '😀b']);
  });
});
