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
  return response.body.run as { model: string | null; modelSwitch: unknown };
}

const BEFORE_FIRST_SESSION = [
  DEFAULT_CHOICE,
  { id: 'opus', label: 'Opus 5.5', description: null },
  { id: 'sonnet', label: 'Sonnet 5.5', description: null },
];
const AFTER_FIRST_SESSION = [
  DEFAULT_CHOICE,
  { id: 'claude-opus-5-5', label: 'Opus 5.5', description: null },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', description: null },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', description: null },
];

async function pinnedChat(send: ReturnType<typeof client>, model: string, provider = 'claude') {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id);
  await send('patch', `/api/conversations/${id}/settings`, {
    provider,
    model,
    routing: 'pinned',
  }).expect(200);
  return id;
}

describe('a pinned model across an app restart', () => {
  it.each(['sonnet', 'opus', 'haiku'])(
    'sends the alias %s as typed after the agent lists its models under full ids',
    async (alias) => {
      await saveCapabilities(t.db, t.workspaceId, snapshot(BEFORE_FIRST_SESSION));
      const send = client();
      const id = await pinnedChat(send, alias);
      expect(await sendMessage(send, id)).toMatchObject({ model: alias, modelSwitch: null });

      await saveCapabilities(t.db, t.workspaceId, snapshot(AFTER_FIRST_SESSION));
      expect(await sendMessage(client(), id)).toMatchObject({ model: alias, modelSwitch: null });
    },
  );

  it('sends an alias as typed when a later session lists it with a context suffix', async () => {
    await saveCapabilities(t.db, t.workspaceId, snapshot(BEFORE_FIRST_SESSION));
    const send = client();
    const id = await pinnedChat(send, 'opus');
    await saveCapabilities(
      t.db,
      t.workspaceId,
      snapshot([
        DEFAULT_CHOICE,
        { id: 'opus[1m]', label: 'Opus 5.5 (1M context)', description: null },
        SONNET,
      ]),
    );
    expect(await sendMessage(client(), id)).toMatchObject({ model: 'opus', modelSwitch: null });
  });

  it('keeps a full id on the same model when the agent lists it with a context suffix', async () => {
    const fable = { id: 'claude-fable-5-1', label: 'Fable 5.1', description: null };
    await saveCapabilities(t.db, t.workspaceId, snapshot([DEFAULT_CHOICE, fable]));
    const send = client();
    const id = await pinnedChat(send, 'claude-fable-5-1');
    await saveCapabilities(
      t.db,
      t.workspaceId,
      snapshot([DEFAULT_CHOICE, { ...fable, id: 'claude-fable-5-1[1m]' }]),
    );
    expect((await sendMessage(client(), id)).model).toBe('claude-fable-5-1[1m]');
  });

  it('sends Claude a pin it no longer lists, for Claude to resolve, and never another generation', async () => {
    await saveCapabilities(t.db, t.workspaceId, snapshot(AFTER_FIRST_SESSION));
    const send = client();
    const id = await pinnedChat(send, 'claude-sonnet-5-5');
    await saveCapabilities(
      t.db,
      t.workspaceId,
      snapshot(AFTER_FIRST_SESSION.filter((model) => model.id !== 'claude-sonnet-5-5')),
    );
    expect(await sendMessage(client(), id)).toMatchObject({
      model: 'claude-sonnet-5-5',
      modelSwitch: null,
    });
  });

  it('still falls back to the default, with a note, where the agent does not resolve names', async () => {
    await connectCliProvider(t, 'codex');
    const luna = { id: 'gpt-6-luna', label: '6 Luna', description: null };
    const sol = { id: 'gpt-6-sol', label: '6 Sol', description: null };
    const codex = (models: CapabilitySnapshot['models']): CapabilitySnapshot => ({
      provider: 'codex',
      models,
      efforts: [],
      defaultModel: 'gpt-6-sol',
    });
    await saveCapabilities(t.db, t.workspaceId, codex([sol, luna]));
    const send = client();
    const id = await pinnedChat(send, 'gpt-6-luna', 'codex');
    await saveCapabilities(t.db, t.workspaceId, codex([sol]));
    const run = await sendMessage(send, id);
    expect(run.model).toBe('gpt-6-sol');
    expect(run.modelSwitch).toMatchObject({
      provider: 'codex',
      from: { id: 'gpt-6-luna', label: 'gpt-6-luna' },
      to: { id: 'gpt-6-sol', label: '6 Sol' },
      learned: false,
    });
  });
});
