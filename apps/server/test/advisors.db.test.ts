import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VerifyEvent } from '@spark-outpost/contracts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, HOST, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const FAKE_JEV_KEY = 'fake-typesafe-key-0000000000009z8y';

let t: TestDb;
let secrets: SecretStore;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await t.cleanup();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const typesafeModels = {
  models: [
    { name: 'jev-preview', description: 'Newest build', release_date: '2026-01-01' },
    { name: 'jev-latest', description: 'Latest stable', release_date: '2026-01-01' },
  ],
};

function appWith(fetch: typeof globalThis.fetch) {
  const app = createTestApp(t, { fetch, secrets });
  const send = (method: 'post' | 'delete', path: string, body: object = {}) =>
    request(app)[method](path).set('Host', HOST).set('Origin', ORIGIN).send(body);
  return {
    get: (path: string) => request(app).get(path).set('Host', HOST),
    send,
    async verify(body: object): Promise<VerifyEvent[]> {
      const response = await send('post', '/api/providers/jev/verify', body).expect(200);
      return response.text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as VerifyEvent);
    },
  };
}

describe('Jev connection', () => {
  it('lists Jev as an advisor, separate from the chat providers', async () => {
    const { body } = await appWith(() => Promise.reject(new Error('offline')))
      .get('/api/setup')
      .expect(200);
    expect(body.providers.map((provider: { id: string }) => provider.id)).toEqual([
      'claude',
      'codex',
      'zai',
    ]);
    expect(body.advisors).toEqual([
      expect.objectContaining({
        id: 'jev',
        maker: 'TypeSafe',
        methods: ['api_key'],
        connection: null,
      }),
    ]);
  });

  it('verifies the key with the free model list and keeps it only in the secret store', async () => {
    const requests: Request[] = [];
    const app = appWith(async (input) => {
      requests.push(input as Request);
      return jsonResponse(200, typesafeModels);
    });

    const events = await app.verify({ method: 'api_key', apiKey: FAKE_JEV_KEY });

    expect(events).toContainEqual({ type: 'step_succeeded', label: 'Key accepted' });
    expect(events.at(-1)).toMatchObject({ type: 'connected', connection: { detail: '…9z8y' } });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.url).toBe('https://typesafe.test/v1/models');
    expect(requests[0]!.headers.get('authorization')).toBe(`Bearer ${FAKE_JEV_KEY}`);
    expect(await secrets.get('jev')).toBe(FAKE_JEV_KEY);

    const { body } = await app.get('/api/setup');
    expect(body.advisors[0].connection).toMatchObject({
      method: 'api_key',
      detail: '…9z8y',
      model: 'jev-latest',
      models: [
        { id: 'jev-preview', label: 'jev-preview' },
        { id: 'jev-latest', label: 'jev-latest' },
      ],
    });
    expect(body.profile).toMatchObject({ defaultProvider: null, onboardingCompleted: false });
    expect(JSON.stringify(body)).not.toContain(FAKE_JEV_KEY);
    const stored = await t.db.query('SELECT * FROM advisor_connections');
    expect(JSON.stringify(stored.rows)).not.toContain(FAKE_JEV_KEY);
    const providers = await t.db.query('SELECT * FROM provider_connections');
    expect(providers.rows).toHaveLength(0);
  });

  it('reports a rejected key and keeps nothing', async () => {
    const app = appWith(async () => jsonResponse(401, { detail: 'invalid' }));
    const events = await app.verify({ method: 'api_key', apiKey: FAKE_JEV_KEY });
    expect(events.at(-1)).toEqual({
      type: 'step_failed',
      label:
        "TypeSafe rejected this key (401 Unauthorized). Check that it's active and copied in full.",
    });
    expect(await secrets.get('jev')).toBeNull();
    expect((await app.get('/api/setup')).body.advisors[0].connection).toBeNull();
  });

  it('refuses the CLI method, test messages, and chat defaults', async () => {
    const app = appWith(async () => jsonResponse(200, typesafeModels));
    await app.send('post', '/api/providers/jev/verify', { method: 'cli' }).expect(400);
    await app.verify({ method: 'api_key', apiKey: FAKE_JEV_KEY });
    await app.send('post', '/api/providers/jev/test').expect(400);
    await request(createTestApp(t, { secrets }))
      .patch('/api/profile')
      .set('Host', HOST)
      .set('Origin', ORIGIN)
      .send({ defaultProvider: 'jev' })
      .expect(400);
  });

  it('disconnects and removes the key', async () => {
    const app = appWith(async () => jsonResponse(200, typesafeModels));
    await app.verify({ method: 'api_key', apiKey: FAKE_JEV_KEY });
    const { body } = await app.send('delete', '/api/providers/jev/connection').expect(200);
    expect(body.advisors[0].connection).toBeNull();
    expect(await secrets.get('jev')).toBeNull();

    await app.verify({ method: 'api_key', apiKey: FAKE_JEV_KEY });
    expect((await app.get('/api/setup')).body.advisors[0].connection).not.toBeNull();
  });
});
