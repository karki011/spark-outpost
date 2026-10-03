import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveCapabilities, type CapabilitySnapshot } from '../src/persistence/chat-settings.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
});

afterEach(async () => {
  await t.cleanup();
});

const DEFAULT_CHOICE = { id: 'default', label: 'Default (recommended)', description: 'Opus 5.5' };
const SONNET = { id: 'sonnet', label: 'Sonnet 5', description: null };

function snapshot(models: CapabilitySnapshot['models']): CapabilitySnapshot {
  return {
    provider: 'claude',
    models,
    efforts: [{ id: 'medium', label: 'Medium', description: null }],
    defaultModel: 'default',
  };
}

function client() {
  const app = createTestApp(t, { fixedRunProvider: null });
  return (method: 'patch' | 'post', path: string, body: object) =>
    request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
}

async function sendMessage(send: ReturnType<typeof client>, conversationId: string) {
  const response = await send('post', `/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content: 'Keep building',
  }).expect(201);
  return response.body.run as { model: string | null };
}

describe('a pinned model across an app restart', () => {
  it('keeps the pinned model when a later session lists it under another alias', async () => {
    await saveCapabilities(
      t.db,
      t.workspaceId,
      snapshot([DEFAULT_CHOICE, { id: 'opus', label: 'Opus 5.5', description: null }, SONNET]),
    );
    const before = client();
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    await before('patch', `/api/conversations/${id}/settings`, {
      model: 'opus',
      routing: 'pinned',
    }).expect(200);
    expect((await sendMessage(before, id)).model).toBe('opus');

    await saveCapabilities(
      t.db,
      t.workspaceId,
      snapshot([
        DEFAULT_CHOICE,
        { id: 'opus[1m]', label: 'Opus 5.5 (1M context)', description: null },
        SONNET,
      ]),
    );
    const after = client();
    expect((await sendMessage(after, id)).model).toBe('opus[1m]');
  });

  it('still falls back to the default for a pin the agent no longer offers at all', async () => {
    await saveCapabilities(t.db, t.workspaceId, snapshot([DEFAULT_CHOICE, SONNET]));
    const send = client();
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    await send('patch', `/api/conversations/${id}/settings`, {
      model: 'opus',
      routing: 'pinned',
    }).expect(200);
    expect((await sendMessage(send, id)).model).toBe('default');
  });
});
