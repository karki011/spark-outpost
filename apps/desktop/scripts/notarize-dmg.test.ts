import { describe, expect, it } from 'vitest';
import { notarizeDmgs, notaryCredentialArgs } from './notarize-dmg.ts';

const APPLE_ID = {
  APPLE_ID: 'me@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
  APPLE_TEAM_ID: 'TEAM123',
};

describe('notaryCredentialArgs', () => {
  it('prefers an API key, then an Apple ID, then a keychain profile', () => {
    expect(
      notaryCredentialArgs({
        ...APPLE_ID,
        APPLE_API_KEY: '/keys/AuthKey.p8',
        APPLE_API_KEY_ID: 'KEY1',
        APPLE_API_ISSUER: 'issuer',
      }),
    ).toEqual(['--key', '/keys/AuthKey.p8', '--key-id', 'KEY1', '--issuer', 'issuer']);
    expect(notaryCredentialArgs(APPLE_ID)).toEqual([
      '--apple-id',
      'me@example.com',
      '--password',
      'app-password',
      '--team-id',
      'TEAM123',
    ]);
    expect(
      notaryCredentialArgs({ APPLE_KEYCHAIN: 'login', APPLE_KEYCHAIN_PROFILE: 'spark' }),
    ).toEqual(['--keychain-profile', 'spark', '--keychain', 'login']);
    expect(notaryCredentialArgs({ APPLE_ID: 'me@example.com' })).toBeNull();
  });
});

describe('notarizeDmgs', () => {
  it('submits and staples only the DMGs', async () => {
    const calls: string[][] = [];
    const dmgs = await notarizeDmgs(
      ['/out/Spark-x64.zip', '/out/Spark-x64.dmg', '/out/Spark-arm64.dmg'],
      APPLE_ID,
      async (command, args) => calls.push([command, ...args]),
    );
    expect(dmgs).toEqual(['/out/Spark-x64.dmg', '/out/Spark-arm64.dmg']);
    expect(calls.map((call) => call.slice(0, 4))).toEqual([
      ['xcrun', 'notarytool', 'submit', '/out/Spark-x64.dmg'],
      ['xcrun', 'stapler', 'staple', '/out/Spark-x64.dmg'],
      ['xcrun', 'notarytool', 'submit', '/out/Spark-arm64.dmg'],
      ['xcrun', 'stapler', 'staple', '/out/Spark-arm64.dmg'],
    ]);
  });

  it('never repeats the credentials in its error', async () => {
    const failing = notarizeDmgs(['/out/Spark-x64.dmg'], APPLE_ID, async () => {
      throw new Error('submit --password app-password failed');
    });
    await expect(failing).rejects.toThrow('Apple did not accept /out/Spark-x64.dmg');
    await expect(failing).rejects.not.toThrow('app-password');
  });

  it('refuses to run without credentials', async () => {
    await expect(notarizeDmgs(['/out/Spark-x64.dmg'], {})).rejects.toThrow(
      'Notarization credentials are missing',
    );
  });
});
