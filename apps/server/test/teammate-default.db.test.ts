import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Teammate, TeammateChat, TeammateList } from '@spark-outpost/contracts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestApp, localClient } from './app-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let client: ReturnType<typeof localClient>;

beforeEach(async () => {
  t = await createTestDb();
  client = localClient(createTestApp(t));
  await connectCliProvider(t, 'claude');
});

afterEach(async () => {
  await t.cleanup();
});

async function create(body: Record<string, unknown>): Promise<Teammate> {
  const response = await client.send('post', '/api/teammates', body);
  expect(response.status).toBe(201);
  return response.body as Teammate;
}

async function setDefault(teammateId: string | null) {
  return client.send('put', '/api/teammate-default', { teammateId });
}

async function defaultId(): Promise<string | null> {
  return ((await client.get('/api/teammates')).body as TeammateList).defaultTeammateId;
}

async function startNew(conversationId: string): Promise<TeammateChat> {
  const response = await client.send(
    'post',
    `/api/conversations/${conversationId}/default-teammate`,
    {},
  );
  expect(response.status).toBe(200);
  return response.body as TeammateChat;
}

async function sparkOf(conversationId: string): Promise<string | null> {
  const detail = await getConversationDetail(t.db, conversationId);
  return detail?.conversation.teammate?.name ?? null;
}

describe('the Spark for new chats', () => {
  it('is none until one is picked, holds one Spark at a time and can be turned off', async () => {
    const pip = await create({ name: 'Pip' });
    const wren = await create({ name: 'Wren' });
    expect(await defaultId()).toBeNull();

    expect((await setDefault(pip.id)).status).toBe(200);
    expect(await defaultId()).toBe(pip.id);
    await setDefault(wren.id);
    expect(await defaultId()).toBe(wren.id);
    await setDefault(null);
    expect(await defaultId()).toBeNull();
  });

  it('refuses a Spark that does not exist', async () => {
    expect((await setDefault(randomUUID())).status).toBe(404);
  });

  it('links a new chat as Talk to does, with the Spark’s settings', async () => {
    const bolt = await create({
      name: 'Bolt',
      provider: 'claude',
      model: 'opus',
      agentMode: 'plan',
      level: 'hands-off',
    });
    await setDefault(bolt.id);
    const conversationId = randomUUID();

    const linked = await startNew(conversationId);

    expect(linked.teammate).toMatchObject({ id: bolt.id, name: 'Bolt' });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.settings).toMatchObject({
      provider: 'claude',
      model: 'opus',
      agentMode: 'plan',
      level: 'hands-off',
    });
  });

  it('creates nothing when no Spark is the default', async () => {
    await create({ name: 'Pip' });
    const conversationId = randomUUID();
    expect((await startNew(conversationId)).teammate).toBeNull();
    expect(await getConversationDetail(t.db, conversationId)).toBeNull();
  });

  it('keeps the user’s own choice of No Spark or another Spark', async () => {
    const pip = await create({ name: 'Pip' });
    const wren = await create({ name: 'Wren' });
    await setDefault(pip.id);
    const plain = randomUUID();
    const other = randomUUID();
    await startNew(plain);
    await client.send('put', `/api/conversations/${plain}/teammate`, { teammateId: null });
    await client.send('put', `/api/conversations/${other}/teammate`, { teammateId: wren.id });

    expect((await startNew(plain)).teammate).toBeNull();
    expect((await startNew(other)).teammate).toMatchObject({ name: 'Wren' });
    expect(await sparkOf(plain)).toBeNull();
    expect(await sparkOf(other)).toBe('Wren');
  });

  it('never touches a chat that already exists', async () => {
    const pip = await create({ name: 'Pip' });
    await setDefault(pip.id);
    const { conversationId } = await startChat(t, 'hello');

    expect((await startNew(conversationId)).teammate).toBeNull();
    expect(await sparkOf(conversationId)).toBeNull();
  });

  it('drops the link when the new chat becomes a Terminal session', async () => {
    const pip = await create({ name: 'Pip', provider: 'claude', model: 'opus' });
    await setDefault(pip.id);
    const conversationId = randomUUID();
    await startNew(conversationId);

    const made = await client.send('post', '/api/conversations', {
      id: conversationId,
      sessionType: 'terminal',
    });

    expect(made.status).toBe(201);
    expect(await sparkOf(conversationId)).toBeNull();
  });

  it('goes back to none when its Spark is deleted, and keeps the chats', async () => {
    const pip = await create({ name: 'Pip' });
    await setDefault(pip.id);
    const conversationId = randomUUID();
    await startNew(conversationId);
    await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'Review my branch' },
      { provider: 'fake' },
    );

    await client.send('delete', `/api/teammates/${pip.id}`);

    expect(await defaultId()).toBeNull();
    expect(await sparkOf(conversationId)).toBeNull();
    expect((await startNew(randomUUID())).teammate).toBeNull();
  });
});
