import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VerifyEvent } from '@spark-outpost/contracts';
import { KEYCHAIN_WAITING_MESSAGE, type Keyring } from '../src/setup/keychain.ts';
import { keychainSecretStore } from '../src/setup/secrets.ts';
import { createTestApp, installedClis, jsonResponse, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const CLAUDE_KEY = `sk-ant-api03-${'x'.repeat(24)}4f2a`;
const TIMEOUT_MS = 300;

const anthropicModels = {
  data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }],
};

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

function promptingKeyring(holdWrites = false) {
  const stored = new Map<string, string>();
  const waiting: (() => void)[] = [];
  let prompting = true;
  const prompt = () =>
    prompting ? new Promise<void>((allow) => waiting.push(allow)) : Promise.resolve();
  const keyring: Keyring = {
    async get(account) {
      await prompt();
      return stored.get(account) ?? null;
    },
    async set(account, secret) {
      if (holdWrites) await prompt();
      stored.set(account, secret);
    },
    async delete(account) {
      stored.delete(account);
    },
  };
  return {
    keyring,
    alwaysAllow() {
      prompting = false;
      for (const allow of waiting.splice(0)) allow();
    },
  };
}

function appWith(keyring: Keyring) {
  const secrets = keychainSecretStore('Spark Outpost Test', {
    keyring,
    timeoutMs: TIMEOUT_MS,
    freshMs: 0,
  });
  return localClient(
    createTestApp(t, {
      runCommand: installedClis,
      secrets,
      fetch: async (input) => {
        const req = input as Request;
        if (req.url.endsWith('/v1/messages')) {
          return jsonResponse(200, { model: 'claude-sonnet-5', content: [] });
        }
        return jsonResponse(200, anthropicModels);
      },
    }),
  );
}

async function keychainWaiting(app: ReturnType<typeof appWith>): Promise<boolean> {
  return (await app.get('/api/providers/health').expect(200)).body.keychainWaiting;
}

describe('a macOS keychain prompt', () => {
  it('leaves the API responsive after a restart and turns a held key read into a clear test failure', async () => {
    const macos = promptingKeyring();
    await appWith(macos.keyring)
      .send('post', '/api/providers/claude/verify', { method: 'api_key', apiKey: CLAUDE_KEY })
      .expect(200);
    const app = appWith(macos.keyring);

    const testing = app.send('post', '/api/providers/claude/test').then((response) => response);
    const startedAt = Date.now();
    await app.get('/api/health').expect(200, { ok: true });
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUT_MS);

    const { body } = await testing;
    expect(body.providers[0].connection.lastTest).toMatchObject({
      ok: false,
      message: expect.stringContaining('Always Allow'),
    });
    expect(await keychainWaiting(app)).toBe(true);

    macos.alwaysAllow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await keychainWaiting(app)).toBe(false);
    const retried = await app.send('post', '/api/providers/claude/test').expect(200);
    expect(retried.body.providers[0].connection.lastTest).toMatchObject({ ok: true });
  });

  it('reports a held key save as a failed verify step instead of hanging', async () => {
    const macos = promptingKeyring(true);
    const app = appWith(macos.keyring);
    const response = await app
      .send('post', '/api/providers/claude/verify', { method: 'api_key', apiKey: CLAUDE_KEY })
      .expect(200);
    const events = response.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as VerifyEvent);
    expect(events.at(-1)).toEqual({ type: 'step_failed', label: KEYCHAIN_WAITING_MESSAGE });
    expect((await app.get('/api/setup').expect(200)).body.providers[0].connection).toBeNull();
    macos.alwaysAllow();
  });
});
