import { describe, expect, it } from 'vitest';
import { memorySecretStore } from '../setup/secrets.ts';
import { resolveUserServer, type UserMcpLaunch } from './launch.ts';
import { readMcpSecrets, secretNames, writeMcpSecrets } from './secrets.ts';

const ID = '00000000-0000-4000-8000-000000000001';

const launch: UserMcpLaunch = {
  id: ID,
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: [],
  url: null,
  envNames: ['GITHUB_TOKEN', 'MISSING'],
  headerNames: [],
  fingerprint: 'fp',
};

describe('MCP secrets in the keychain', () => {
  it('stores values per server and deletes the entry when nothing is left', async () => {
    const store = memorySecretStore();
    await writeMcpSecrets(store, ID, { env: { GITHUB_TOKEN: 't1' }, headers: { 'X-Key': 'k' } });
    expect(await store.get(`mcp:${ID}`)).toContain('t1');
    const values = await readMcpSecrets(store, ID);
    expect(secretNames(values)).toEqual(['GITHUB_TOKEN', 'X-Key']);
    await writeMcpSecrets(store, ID, { env: {}, headers: {} });
    expect(await store.get(`mcp:${ID}`)).toBeNull();
  });

  it('treats a missing store, missing entry or unreadable entry as no values', async () => {
    expect(await readMcpSecrets(undefined, ID)).toEqual({ env: {}, headers: {} });
    const store = memorySecretStore({ [`mcp:${ID}`]: 'not json' });
    expect(await readMcpSecrets(store, ID)).toEqual({ env: {}, headers: {} });
  });

  it('resolves values at launch for known names only and leaves out names with no value', async () => {
    const store = memorySecretStore({
      [`mcp:${ID}`]: JSON.stringify({ env: { GITHUB_TOKEN: 't1', STALE: 'old' }, headers: {} }),
    });
    const config = await resolveUserServer(launch, store);
    expect(config.env).toEqual({ GITHUB_TOKEN: 't1' });
    expect(config).toMatchObject({ name: 'github', command: 'npx', fingerprint: 'fp' });
  });
});
