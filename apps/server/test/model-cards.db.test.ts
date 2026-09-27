import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelCardsResponse, ModelStat } from '@spark-outpost/contracts';
import { ingestRound, MEASURED_SEED, seedModelStats } from '../src/model-cards/ingest.ts';
import { loadIntakeContext } from '../src/persistence/advice.ts';
import { saveCapabilities } from '../src/persistence/chat-settings.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { listModelStats } from '../src/persistence/model-stats.ts';
import { saveConnection, updateProfile } from '../src/persistence/setup.ts';
import { createTestApp, HOST, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

const codexModels = [
  { id: 'gpt-6-astra', label: '6 Astra', description: 'Frontier' },
  { id: 'gpt-6-sol', label: '6 Sol', description: 'Workhorse' },
  { id: 'gpt-6-luna', label: '6 Luna', description: 'Fast' },
  { id: 'gpt-7-nova', label: '7 Nova', description: 'Unknown to the cards' },
];
const efforts = [{ id: 'medium', label: 'Medium', description: null }];

async function connectCodex() {
  await saveConnection(t.db, t.workspaceId, 'codex', {
    method: 'cli',
    detail: 'codex 1.0',
    summary: '',
    models: [],
  });
  await saveCapabilities(t.db, t.workspaceId, {
    provider: 'codex',
    models: codexModels,
    efforts,
    defaultModel: 'gpt-6-astra',
  });
  await updateProfile(t.db, t.workspaceId, { defaultProvider: 'codex' });
}

const send = (method: 'get' | 'put' | 'post' | 'patch', path: string, body?: object) => {
  const call = request(app)[method](path).set('Host', HOST).set('Origin', ORIGIN);
  return body ? call.send(body) : call;
};

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t, { fixedRunProvider: null });
});

afterEach(async () => {
  await t.cleanup();
});

describe('measured model stats', () => {
  it('seeds the shipped rounds once, however often the API starts', async () => {
    await seedModelStats(t.db);
    await seedModelStats(t.db);
    const stats = await listModelStats(t.db);
    expect(stats).toHaveLength(MEASURED_SEED.stats.length);
    expect(stats).toContainEqual(
      expect.objectContaining({
        model: 'claude-opus-5-5',
        role: 'architect',
        category: 'plan',
        effort: 'high',
      }),
    );
  });

  it('replaces a re-ingested round instead of adding to it', async () => {
    await seedModelStats(t.db);
    const result = (task: string, passed: boolean) => ({
      task,
      startedAt: '2026-10-02T09:00:00Z',
      agents: [
        {
          role: 'agent',
          provider: 'claude',
          model: 'haiku',
          effort: null,
          costUsd: 0.02,
          costSource: 'reported',
          durationMs: 9_000,
        },
      ],
      verification: { passed },
    });
    const categories = { T1: 'fix', T3: 'feature' } as const;
    await ingestRound(
      t.db,
      { date: 'r5', results: [result('T1', true), result('T3', true)] },
      'r5.json',
      categories,
    );
    await ingestRound(t.db, { date: 'r5', results: [result('T1', false)] }, 'r5.json', categories);
    const round = (await listModelStats(t.db)).filter((stat: ModelStat) => stat.round === 'r5');
    expect(round).toEqual([
      expect.objectContaining({ category: 'fix', n: 1, passed: 0, effort: null }),
    ]);
    expect((await listModelStats(t.db)).length).toBe(MEASURED_SEED.stats.length + 1);
  });
});

describe('model cards API', () => {
  it('shows each provider with its cards, stats, default and the models without a card', async () => {
    await seedModelStats(t.db);
    await connectCodex();
    const response = await send('get', '/api/model-cards').expect(200);
    const body = response.body as ModelCardsResponse;
    expect(body.providers.map((provider) => provider.provider.provider)).toEqual([
      'claude',
      'codex',
      'zai',
    ]);
    const codex = body.providers.find((provider) => provider.provider.provider === 'codex')!;
    expect(codex).toMatchObject({ connected: true, hasFrontier: true });
    const sol = codex.models.find((model) => model.card.id === 'gpt-6-sol')!;
    expect(sol).toMatchObject({ offered: true, isDefault: true });
    expect(sol.stats[0]).toMatchObject({ role: 'critic', category: 'review', n: 1 });
    expect(sol.jevText.length).toBeLessThanOrEqual(160);
    expect(codex.models.find((model) => model.card.id === 'gpt-6-astra')).toMatchObject({
      offered: true,
      isDefault: false,
    });
    expect(codex.models.find((model) => model.card.id === 'gpt-5.5')?.offered).toBe(false);
    expect(codex.uncardedModels).toEqual([{ id: 'gpt-7-nova', label: '7 Nova' }]);
    expect(body.providers.find((p) => p.provider.provider === 'claude')?.connected).toBe(false);
  });

  it('hands the stats to Jev with each candidate and has no frontier switch', async () => {
    await seedModelStats(t.db);
    await connectCodex();
    await send('put', '/api/model-cards/frontier/codex', { allowed: true }).expect(404);
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const context = await loadIntakeContext(t.db, t.workspaceId, conversation.id);
    expect(context.candidates[0]).toMatchObject({ provider: 'codex' });
    expect(context.candidates[0]!.stats!.length).toBe(MEASURED_SEED.stats.length);
  });
});

describe('effective default model', () => {
  it('sends 6 Sol for an unpinned Codex chat whose adapter default is 6 Astra', async () => {
    await connectCodex();
    const capabilities = await send('get', '/api/providers/codex/capabilities').expect(200);
    expect(capabilities.body).toMatchObject({
      defaultModel: 'gpt-6-sol',
      agentDefaultModel: 'gpt-6-astra',
    });

    const id = randomUUID();
    await send('post', '/api/conversations', { id }).expect(201);
    const sent = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Hello',
    }).expect(201);
    expect(sent.body.run).toMatchObject({ provider: 'codex', model: 'gpt-6-sol' });

    await send('patch', `/api/conversations/${id}/settings`, {
      provider: 'codex',
      model: 'gpt-6-astra',
    }).expect(200);
    const pinned = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Again',
    }).expect(201);
    expect(pinned.body.run).toMatchObject({ model: 'gpt-6-astra' });
  });
});
