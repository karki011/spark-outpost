import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadIntakeContext } from '../src/persistence/advice.ts';
import { saveCapabilities } from '../src/persistence/chat-settings.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { createTestApp, HOST, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

const option = (id: string) => ({ id, label: id, description: null });

const connectClaude = () =>
  saveConnection(t.db, t.workspaceId, 'claude', {
    method: 'cli',
    detail: 'claude 1.0',
    summary: '',
    models: [],
  });

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t, {
    fixedRunProvider: null,
    probeCapabilities: async (provider) => ({
      provider,
      models: [option('fast')],
      efforts: [option('default'), option('low'), option('xhigh')],
      defaultModel: 'fast',
    }),
  });
});

afterEach(async () => {
  await t.cleanup();
});

const send = (method: 'get' | 'patch', path: string, body?: object) => {
  const call = request(app)[method](path).set('Host', HOST).set('Origin', ORIGIN);
  return body ? call.send(body) : call;
};

const setEffort = (effort: string | null) =>
  send('patch', '/api/providers/claude/defaults', { effort });

async function storedEffort(): Promise<string | null> {
  const { body } = await send('get', '/api/setup').expect(200);
  return body.providers[0].connection.effort;
}

async function freshChatEffort(): Promise<string | null> {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id);
  const { body } = await send('get', `/api/conversations/${id}`).expect(200);
  return body.settings.effort;
}

describe('provider default effort', () => {
  it('starts unset, then saves only an effort the provider reports', async () => {
    await connectClaude();
    expect(await storedEffort()).toBeNull();
    expect(await freshChatEffort()).toBeNull();

    await setEffort('xhigh').expect(400);
    await send('get', '/api/providers/claude/capabilities').expect(200);
    await setEffort('high').expect(400);
    await setEffort('default').expect(400);
    await setEffort('xhigh').expect(200);
    expect(await storedEffort()).toBe('xhigh');
  });

  it('preselects the default in fresh chats and hands it to the Builder route', async () => {
    await connectClaude();
    await send('get', '/api/providers/claude/capabilities').expect(200);
    await setEffort('xhigh').expect(200);
    expect(await freshChatEffort()).toBe('xhigh');

    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const own = await send('patch', `/api/conversations/${id}/settings`, { effort: 'low' });
    expect(own.body.effort).toBe('low');
    const context = await loadIntakeContext(t.db, t.workspaceId, id);
    expect(context.defaultEfforts).toEqual({ claude: 'xhigh' });
  });

  it('keeps the choice across reconnects and clears it on request', async () => {
    await connectClaude();
    await send('get', '/api/providers/claude/capabilities').expect(200);
    await setEffort('xhigh').expect(200);
    await connectClaude();
    expect(await storedEffort()).toBe('xhigh');

    await setEffort(null).expect(200);
    expect(await storedEffort()).toBeNull();
    expect(await freshChatEffort()).toBeNull();
  });

  it('falls back silently once the provider stops reporting the default', async () => {
    await connectClaude();
    await send('get', '/api/providers/claude/capabilities').expect(200);
    await setEffort('xhigh').expect(200);
    await saveCapabilities(t.db, t.workspaceId, {
      provider: 'claude',
      models: [option('fast')],
      efforts: [option('low'), option('high')],
      defaultModel: 'fast',
    });
    expect(await freshChatEffort()).toBeNull();
    expect(await storedEffort()).toBe('xhigh');
  });

  it('rejects a malformed effort at the API boundary', async () => {
    await connectClaude();
    await setEffort('').expect(400);
    await send('patch', '/api/providers/claude/defaults', { effort: 42 }).expect(400);
  });
});
