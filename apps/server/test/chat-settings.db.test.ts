import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { saveConnection, updateProfile } from '../src/persistence/setup.ts';
import { createTestApp, HOST, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let probes = 0;
let app: ReturnType<typeof createTestApp>;

const connect = (provider: 'claude' | 'codex') =>
  saveConnection(t.db, t.workspaceId, provider, {
    method: 'cli',
    detail: `${provider} 1.0`,
    summary: '',
    models: [],
  });

beforeEach(async () => {
  t = await createTestDb();
  probes = 0;
  app = createTestApp(t, {
    fixedRunProvider: null,
    probeCapabilities: async (provider) => {
      probes += 1;
      return {
        provider,
        models: [{ id: 'fast', label: 'Fast', description: 'Quick answers' }],
        efforts: [{ id: 'low', label: 'Low', description: null }],
        defaultModel: 'fast',
      };
    },
  });
});

afterEach(async () => {
  await t.cleanup();
});

const send = (method: 'get' | 'patch' | 'post', path: string, body?: object) => {
  const call = request(app)[method](path).set('Host', HOST).set('Origin', ORIGIN);
  return body ? call.send(body) : call;
};

describe('chat settings', () => {
  it('start from the default provider and override per chat without touching defaults', async () => {
    await connect('claude');
    await connect('codex');
    await updateProfile(t.db, t.workspaceId, { defaultProvider: 'claude' });
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);

    const initial = await send('get', `/api/conversations/${id}`).expect(200);
    expect(initial.body.settings).toEqual({
      provider: 'claude',
      model: null,
      effort: null,
      permission: 'ask',
      level: 'balanced',
      routing: 'pinned',
    });

    const switched = await send('patch', `/api/conversations/${id}/settings`, {
      provider: 'codex',
      model: 'gpt-6-sol',
    }).expect(200);
    expect(switched.body).toEqual({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: null,
      permission: 'ask',
      level: 'balanced',
      routing: 'pinned',
    });

    const effort = await send('patch', `/api/conversations/${id}/settings`, {
      effort: 'high',
    }).expect(200);
    expect(effort.body).toMatchObject({ provider: 'codex', model: 'gpt-6-sol', effort: 'high' });

    const message = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Hi',
    }).expect(201);
    expect(message.body.run).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'high',
    });

    const other = randomUUID();
    await createConversation(t.db, t.workspaceId, other);
    const fresh = await send('get', `/api/conversations/${other}`).expect(200);
    expect(fresh.body.settings.provider).toBe('claude');
  });

  it('sends the default model from the capability snapshot when the chat has none', async () => {
    await connect('claude');
    await send('get', '/api/providers/claude/capabilities').expect(200);
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const message = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Hi',
    }).expect(201);
    expect(message.body.run).toMatchObject({ provider: 'claude', model: 'fast' });

    await send('patch', `/api/conversations/${id}/settings`, { model: 'retired' }).expect(200);
    const retired = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Again',
    }).expect(201);
    expect(retired.body.run.model).toBe('fast');
  });

  it('lets a CLI provider pick a default model from its capability snapshot', async () => {
    await connect('claude');
    await send('patch', '/api/providers/claude/defaults', { model: 'fast' }).expect(400);
    await send('get', '/api/providers/claude/capabilities').expect(200);
    await send('patch', '/api/providers/claude/defaults', { model: 'fast' }).expect(200);
    await send('patch', '/api/providers/claude/defaults', { model: 'nope' }).expect(400);
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const detail = await send('get', `/api/conversations/${id}`).expect(200);
    expect(detail.body.settings).toMatchObject({ provider: 'claude', model: 'fast' });
  });

  it('remembers each provider’s choices when the chat switches back and forth', async () => {
    await connect('claude');
    await connect('codex');
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const path = `/api/conversations/${id}/settings`;
    await send('patch', path, {
      model: 'sonnet',
      effort: 'max',
      permission: 'do',
      level: 'hands-off',
    }).expect(200);
    await send('patch', path, { provider: 'codex' }).expect(200);
    const codex = await send('patch', path, { model: 'gpt-6-sol', effort: 'high' }).expect(200);
    expect(codex.body).toEqual({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'high',
      permission: 'ask',
      level: 'balanced',
      routing: 'pinned',
    });
    const codexDo = await send('patch', path, { permission: 'do' }).expect(200);
    expect(codexDo.body).toMatchObject({ provider: 'codex', permission: 'do' });
    const back = await send('patch', path, { provider: 'claude' }).expect(200);
    expect(back.body).toEqual({
      provider: 'claude',
      model: 'sonnet',
      effort: 'max',
      permission: 'do',
      level: 'hands-off',
      routing: 'pinned',
    });
    const again = await send('patch', path, { provider: 'codex' }).expect(200);
    expect(again.body).toMatchObject({ model: 'gpt-6-sol', effort: 'high' });
    const reset = await send('patch', path, { model: null }).expect(200);
    expect(reset.body.model).toBeNull();
  });

  it('refuses a provider that is not connected', async () => {
    await connect('claude');
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const refused = await send('patch', `/api/conversations/${id}/settings`, {
      provider: 'codex',
    }).expect(400);
    expect(refused.body.error).toBe('Connect this provider before using it in a chat.');
  });
});

describe('provider capabilities', () => {
  it('probes once, then serves the cached snapshot until a refresh is asked for', async () => {
    await connect('claude');
    const first = await send('get', '/api/providers/claude/capabilities').expect(200);
    expect(first.body).toMatchObject({ provider: 'claude', defaultModel: 'fast' });
    await send('get', '/api/providers/claude/capabilities').expect(200);
    expect(probes).toBe(1);
    await send('get', '/api/providers/claude/capabilities?refresh=1').expect(200);
    expect(probes).toBe(2);
    await send('get', '/api/providers/codex/capabilities').expect(400);
  });
});
