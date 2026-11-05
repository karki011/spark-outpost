import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VerifyEvent } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { installedClis, jsonResponse, localClient, testAppOptions } from './app-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const KEY = 'gateway-key-0123456789abcdefTail';
const SPARK_PORT = 4317;
const ENDPOINT = { baseUrl: 'http://localhost:11434/', model: 'qwen3-coder:30b', fastModel: '' };

let t: TestDb;
let secrets: SecretStore;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await t.cleanup();
});

function appWith(fetch: typeof globalThis.fetch, runCommand = installedClis) {
  const app = createApp({
    ...testAppOptions(t, { fetch, secrets, runCommand }),
    sparkPorts: new Set([SPARK_PORT]),
  });
  const { get, send } = localClient(app);
  return {
    app,
    get,
    send,
    async verify(body: object): Promise<{ events: VerifyEvent[]; raw: string }> {
      const response = await send('post', '/api/providers/custom/verify', body).expect(200);
      const raw = response.text;
      return {
        raw,
        events: raw
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as VerifyEvent),
      };
    },
  };
}

const reply = (model = 'qwen3-coder:30b') =>
  jsonResponse(200, { type: 'message', model, content: [{ type: 'text', text: 'OK' }] });

async function customOf(app: ReturnType<typeof appWith>) {
  const { body } = await app.get('/api/setup');
  return body.providers.find((provider: { id: string }) => provider.id === 'custom');
}

describe('custom endpoint connection', () => {
  it('is listed as a key-only provider with a note on the Messages API', async () => {
    const custom = await customOf(appWith(async () => reply()));
    expect(custom).toMatchObject({
      name: 'Custom endpoint',
      methods: ['api_key'],
      keyLink: null,
      note: expect.stringContaining('Anthropic Messages API'),
      connection: null,
    });
  });

  it('checks a local server with one tiny message and keeps the settings in the keychain', async () => {
    const requests: Request[] = [];
    const app = appWith(async (input) => {
      requests.push(input as Request);
      return reply();
    });
    const { events } = await app.verify({ method: 'endpoint', endpoint: ENDPOINT, apiKey: '' });

    expect(events.at(-1)).toMatchObject({ type: 'connected' });
    expect(requests).toHaveLength(1);
    const [sent] = requests;
    expect(sent?.url).toBe('http://localhost:11434/v1/messages');
    expect(sent?.redirect).toBe('manual');
    expect(sent?.headers.get('authorization')).toBe('Bearer spark-outpost-no-key');
    expect(await sent?.json()).toMatchObject({ model: 'qwen3-coder:30b', max_tokens: 16 });
    expect(JSON.parse((await secrets.get('custom')) ?? '')).toEqual({
      baseUrl: 'http://localhost:11434',
      model: 'qwen3-coder:30b',
      fastModel: '',
      apiKey: '',
    });
    expect((await customOf(app)).connection).toMatchObject({
      method: 'api_key',
      detail: 'http://localhost:11434',
      summary: 'No API key',
      models: [
        { id: 'opus', label: 'qwen3-coder:30b' },
        { id: 'haiku', label: 'qwen3-coder:30b' },
      ],
    });
  });

  it('sends a key as the bearer token and keeps it out of the database and responses', async () => {
    const requests: Request[] = [];
    const app = appWith(async (input) => {
      requests.push(input as Request);
      return reply('gpt-oss');
    });
    const { raw } = await app.verify({
      method: 'endpoint',
      endpoint: {
        baseUrl: 'https://gateway.example.com/anthropic',
        model: 'big',
        fastModel: 'small',
      },
      apiKey: KEY,
    });
    expect(raw).not.toContain(KEY);
    expect(requests[0]?.url).toBe('https://gateway.example.com/anthropic/v1/messages');
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    const custom = await customOf(app);
    expect(custom.connection).toMatchObject({
      summary: 'API key in your keychain',
      models: [
        { id: 'opus', label: 'big' },
        { id: 'haiku', label: 'small' },
      ],
    });
    const stored = await t.db.query('SELECT * FROM provider_connections');
    expect(JSON.stringify(stored.rows)).not.toContain(KEY);
    expect(JSON.stringify(custom)).not.toContain(KEY);
  });

  it('refuses addresses that are not https or local, carry a login or end in /v1', async () => {
    const app = appWith(async () => reply());
    for (const baseUrl of [
      'http://192.168.1.20:11434',
      'https://user:pass@gateway.example.com',
      'https://gateway.example.com?key=abc',
      'http://localhost:11434/v1',
      'ftp://localhost',
    ]) {
      await app
        .send('post', '/api/providers/custom/verify', {
          method: 'endpoint',
          endpoint: { ...ENDPOINT, baseUrl },
          apiKey: '',
        })
        .expect(400);
    }
    expect(await secrets.get('custom')).toBeNull();
  });

  it("refuses Spark's own ports and keeps nothing", async () => {
    const requests: Request[] = [];
    const app = appWith(async (input) => {
      requests.push(input as Request);
      return reply();
    });
    const { events } = await app.verify({
      method: 'endpoint',
      endpoint: { ...ENDPOINT, baseUrl: `http://127.0.0.1:${SPARK_PORT}` },
      apiKey: '',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'step_failed',
      label: expect.stringContaining("Spark's own"),
    });
    expect(requests).toHaveLength(0);
    expect(await secrets.get('custom')).toBeNull();
  });

  it('reports what the server answered when the check fails', async () => {
    const outcomes: [() => Promise<Response>, string][] = [
      [
        () => Promise.reject(new TypeError('fetch failed')),
        "Couldn't reach http://localhost:11434",
      ],
      [
        async () => jsonResponse(404, { error: { message: 'model "nope" not found' } }),
        'model "nope" not found',
      ],
      [async () => jsonResponse(401, { error: 'unauthorized' }), 'needs an API key'],
      [async () => new Response(null, { status: 307 }), 'redirected the request (307)'],
      [async () => jsonResponse(200, { choices: [] }), 'not in the Anthropic Messages format'],
    ];
    for (const [answer, expected] of outcomes) {
      const { events } = await appWith(answer).verify({
        method: 'endpoint',
        endpoint: ENDPOINT,
        apiKey: '',
      });
      expect(events.at(-1)).toMatchObject({
        type: 'step_failed',
        label: expect.stringContaining(expected),
      });
    }
    expect(await secrets.get('custom')).toBeNull();
  });

  it('needs the claude CLI, and refuses a plain key, the CLI method and a Terminal session', async () => {
    const missing = appWith(
      async () => reply(),
      async () => ({ code: 1, stdout: '', stderr: '' }),
    );
    const { events } = await missing.verify({ method: 'endpoint', endpoint: ENDPOINT, apiKey: '' });
    expect(events.at(-1)).toMatchObject({ type: 'step_failed', code: 'cli_missing' });

    const app = appWith(async () => reply());
    await app.send('post', '/api/providers/custom/verify', { method: 'cli' }).expect(400);
    await app
      .send('post', '/api/providers/custom/verify', { method: 'api_key', apiKey: KEY })
      .expect(400);
    await app
      .send('post', '/api/providers/zai/verify', {
        method: 'endpoint',
        endpoint: ENDPOINT,
        apiKey: '',
      })
      .expect(400);
    await app.send('post', '/api/terminal/sessions', { provider: 'custom' }).expect(400);
  });

  it('is set on the Mac only, never from a paired device', async () => {
    const { app } = appWith(async () => reply());
    await turnRemoteOn(app);
    const phone = remoteClient(app, (await pairDevice(app)).cookie);
    const response = await phone
      .send('post', '/api/providers/custom/verify', {
        method: 'endpoint',
        endpoint: ENDPOINT,
        apiKey: '',
      })
      .expect(403);
    expect(response.body.error).toContain('on your Mac');
    expect(await secrets.get('custom')).toBeNull();
  });

  it('sends a test message to the stored endpoint and model', async () => {
    const requests: Request[] = [];
    const app = appWith(async (input) => {
      requests.push(input as Request);
      return reply();
    });
    await app.verify({ method: 'endpoint', endpoint: ENDPOINT, apiKey: KEY });
    const { body } = await app.send('post', '/api/providers/custom/test').expect(200);
    const custom = body.providers.find((provider: { id: string }) => provider.id === 'custom');
    expect(custom.connection.lastTest).toMatchObject({
      ok: true,
      message: expect.stringContaining('by qwen3-coder:30b'),
    });
    expect(requests.at(-1)?.url).toBe('http://localhost:11434/v1/messages');
    expect(requests.at(-1)?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('removes the settings and key from the keychain on disconnect', async () => {
    const app = appWith(async () => reply());
    await app.verify({ method: 'endpoint', endpoint: ENDPOINT, apiKey: KEY });
    await app.send('delete', '/api/providers/custom/connection').expect(200);
    expect(await secrets.get('custom')).toBeNull();
    expect((await customOf(app)).connection).toBeNull();
  });
});
