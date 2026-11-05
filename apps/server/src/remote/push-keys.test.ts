import { describe, expect, it } from 'vitest';
import { memorySecretStore } from '../setup/secrets.ts';
import { pushKeys } from './push-keys.ts';

function counter() {
  let made = 0;
  return {
    generate: () => {
      made += 1;
      return { publicKey: `public-${made}`, privateKey: `private-${made}` };
    },
    made: () => made,
  };
}

describe('pushKeys', () => {
  it('makes the keys once, even when asked twice at the same time, and saves them', async () => {
    const secrets = memorySecretStore();
    const keys = counter();
    const holder = pushKeys(secrets, keys.generate);
    const [first, second] = await Promise.all([holder.get(), holder.get()]);
    expect(first).toEqual({ publicKey: 'public-1', privateKey: 'private-1' });
    expect(second).toEqual(first);
    expect(keys.made()).toBe(1);
    expect(JSON.parse((await secrets.get('remote:push'))!)).toEqual(first);
  });

  it('reuses the saved keys after a restart', async () => {
    const secrets = memorySecretStore({
      'remote:push': JSON.stringify({ publicKey: 'kept', privateKey: 'kept-private' }),
    });
    const keys = counter();
    expect(await pushKeys(secrets, keys.generate).get()).toEqual({
      publicKey: 'kept',
      privateKey: 'kept-private',
    });
    expect(keys.made()).toBe(0);
  });

  it('replaces a saved value it cannot read', async () => {
    const secrets = memorySecretStore({ 'remote:push': 'not json' });
    const keys = counter();
    expect((await pushKeys(secrets, keys.generate).get()).publicKey).toBe('public-1');
  });

  it('tries again after the keychain fails', async () => {
    const secrets = memorySecretStore();
    let fail = true;
    const failing = {
      ...secrets,
      get: async (id: Parameters<typeof secrets.get>[0]) => {
        if (fail) throw new Error('keychain locked');
        return secrets.get(id);
      },
    };
    const holder = pushKeys(failing, counter().generate);
    await expect(holder.get()).rejects.toThrow('keychain locked');
    fail = false;
    expect((await holder.get()).publicKey).toBe('public-1');
  });
});
