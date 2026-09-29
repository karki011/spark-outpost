import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VerifyEvent } from '@spark-outpost/contracts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import {
  recordRunMetrics,
  recordSessionSettings,
  recordTokens,
  recordUsage,
} from '../src/workflow/run-metadata.ts';
import { createTestApp, jsonResponse, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const ZAI_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.ZaiSecretTail';

let t: TestDb;
let secrets: SecretStore;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await t.cleanup();
});

function appWith(fetch: typeof globalThis.fetch) {
  const { get, send } = localClient(createTestApp(t, { fetch, secrets }));
  return {
    get,
    send,
    async verify(body: object): Promise<{ events: VerifyEvent[]; raw: string }> {
      const response = await send('post', '/api/providers/zai/verify', body).expect(200);
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

const okMessage = () => jsonResponse(200, { model: 'glm-5.3-flash', content: [] });

describe('Z.ai connection', () => {
  it('lists Z.ai with its billing note and a key-only connection', async () => {
    const { body } = await appWith(async () => okMessage()).get('/api/setup');
    const zai = body.providers.find((provider: { id: string }) => provider.id === 'zai');
    expect(zai).toMatchObject({
      name: 'Z.ai (GLM)',
      maker: 'Z.ai',
      methods: ['api_key'],
      note: 'Uses your Z.ai API key and Z.ai billing; never your Claude account.',
      efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }],
      defaultEffort: 'high',
      connection: null,
    });
    expect(body.providers[0].note).toBeNull();
  });

  it('verifies the key with one tiny Flash message and stores it only in the secret store', async () => {
    const requests: Request[] = [];
    const app = appWith(async (input) => {
      requests.push(input as Request);
      return okMessage();
    });
    const { events, raw } = await app.verify({ method: 'api_key', apiKey: ZAI_KEY });

    expect(events.at(-1)).toMatchObject({ type: 'connected' });
    expect(events).toContainEqual({
      type: 'step_succeeded',
      label: 'GLM-5.3 and GLM-5.3-Flash are available',
    });
    expect(raw).not.toContain(ZAI_KEY);
    const [sent] = requests;
    expect(sent?.url).toBe('https://zai.test/v1/messages');
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${ZAI_KEY}`);
    expect(sent?.headers.get('x-api-key')).toBeNull();
    expect(await sent?.json()).toMatchObject({ model: 'glm-5.3-flash', max_tokens: 16 });
    expect(await secrets.get('zai')).toBe(ZAI_KEY);

    const { body } = await app.get('/api/setup');
    const zai = body.providers.find((provider: { id: string }) => provider.id === 'zai');
    expect(zai.connection).toMatchObject({
      method: 'api_key',
      detail: '…Tail',
      model: 'opus',
      models: [
        { id: 'opus', label: 'GLM-5.3' },
        { id: 'haiku', label: 'GLM-5.3-Flash' },
      ],
      permission: 'do',
      agentMode: 'default',
      effort: 'medium',
    });
    const stored = await t.db.query('SELECT * FROM provider_connections');
    expect(JSON.stringify(stored.rows)).not.toContain(ZAI_KEY);
    expect(JSON.stringify(body)).not.toContain(ZAI_KEY);
  });

  it('explains an account without balance or plan and keeps nothing', async () => {
    const app = appWith(async () =>
      jsonResponse(429, { error: { code: '1113', message: 'Insufficient balance' } }),
    );
    const { events } = await app.verify({ method: 'api_key', apiKey: ZAI_KEY });
    expect(events.at(-1)).toMatchObject({
      type: 'step_failed',
      label: expect.stringContaining('no balance or GLM Coding Plan'),
    });
    expect(await secrets.get('zai')).toBeNull();
  });

  it('refuses the CLI method and an Anthropic key', async () => {
    const app = appWith(async () => okMessage());
    await app.send('post', '/api/providers/zai/verify', { method: 'cli' }).expect(400);
    await app.send('post', '/api/terminal/sessions', { provider: 'zai' }).expect(400);
    const { events } = await app.verify({
      method: 'api_key',
      apiKey: `sk-ant-api03-${'x'.repeat(24)}`,
    });
    expect(events.at(-1)).toMatchObject({
      type: 'step_failed',
      label: expect.stringContaining('under Claude'),
    });
  });

  it('sends a test message to the GLM model behind the chosen slot', async () => {
    const requests: Request[] = [];
    const app = appWith(async (input) => {
      requests.push(input as Request);
      return jsonResponse(200, { model: 'glm-5.3', content: [] });
    });
    await app.verify({ method: 'api_key', apiKey: ZAI_KEY });
    const { body } = await app.send('post', '/api/providers/zai/test').expect(200);
    const zai = body.providers.find((provider: { id: string }) => provider.id === 'zai');
    expect(zai.connection.lastTest).toMatchObject({
      ok: true,
      message: expect.stringContaining('by glm-5.3'),
    });
    expect(await requests.at(-1)?.json()).toMatchObject({ model: 'glm-5.3' });
    expect(requests.at(-1)?.headers.get('authorization')).toBe(`Bearer ${ZAI_KEY}`);
  });

  it('lets Z.ai become the default and removes the key on disconnect', async () => {
    const app = appWith(async () => okMessage());
    await app.verify({ method: 'api_key', apiKey: ZAI_KEY });
    await app
      .send('patch', '/api/providers/zai/defaults', { model: 'haiku', effort: 'max' })
      .expect(200);
    await app.send('patch', '/api/providers/zai/defaults', { effort: 'medium' }).expect(400);
    const { body } = await app
      .send('patch', '/api/profile', { defaultProvider: 'zai', onboardingCompleted: true })
      .expect(200);
    expect(body.profile).toMatchObject({ defaultProvider: 'zai', onboardingCompleted: true });

    await app.send('delete', '/api/providers/zai/connection').expect(200);
    expect(await secrets.get('zai')).toBeNull();
    expect((await app.get('/api/setup')).body.profile.defaultProvider).toBeNull();
  });
});

describe('Z.ai run cost', () => {
  it('records the GLM model and an estimate from GLM prices, labelled estimated', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: 'go' },
      { provider: 'zai', model: 'opus' },
    );
    const lease = (await claimNextJob(t.db, 30))!;
    await recordSessionSettings(t.db, lease.runId, {
      kind: 'session_settings',
      model: 'glm-5.3',
      effort: 'high',
      mode: 'default',
    });
    await recordUsage(t.db, lease.runId, {
      kind: 'usage',
      contextUsed: 10,
      contextSize: 1_000_000,
      costUsd: null,
    });
    await recordTokens(t.db, lease.runId, {
      kind: 'tokens',
      tokens: {
        input: 10_000,
        output: 2_000,
        total: 32_000,
        cachedRead: 20_000,
        cachedWrite: null,
        thought: null,
      },
    });
    await recordRunMetrics(t.db, lease.runId, { durationMs: 1000, toolCallCount: 0 });
    const { rows } = await t.db.query<{
      used_model: string;
      cost_usd: string;
      cost_source: string;
    }>('SELECT used_model, cost_usd, cost_source FROM runs WHERE id = $1', [lease.runId]);
    const expected = (10_000 * 1.4 + 20_000 * 0.26 + 2_000 * 4.4) / 1_000_000;
    expect(rows[0]).toMatchObject({ used_model: 'glm-5.3', cost_source: 'estimated' });
    expect(Number(rows[0]?.cost_usd)).toBeCloseTo(expected, 6);
  });
});
