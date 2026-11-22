import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Teammate } from '@spark-outpost/contracts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { createTestApp, localClient } from './app-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let client: ReturnType<typeof localClient>;
let spark: Teammate;

beforeEach(async () => {
  t = await createTestDb();
  client = localClient(createTestApp(t));
  await connectCliProvider(t, 'claude');
  const made = await client.send('post', '/api/teammates', {
    name: 'Bolt',
    provider: 'claude',
    model: 'opus',
    agentMode: 'plan',
    level: 'hands-off',
  });
  spark = made.body as Teammate;
});

afterEach(async () => {
  await t.cleanup();
});

async function linkedChat(status: 'succeeded' | 'running' | 'queued' | null): Promise<string> {
  const conversationId = randomUUID();
  await client.send('put', `/api/conversations/${conversationId}/teammate`, {
    teammateId: spark.id,
  });
  if (status === null) return conversationId;
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Review my branch' },
    { provider: 'claude' },
  );
  await t.db.query('UPDATE runs SET status = $2 WHERE id = $1', [sent.run.id, status]);
  return conversationId;
}

async function openSession(conversationId: string): Promise<string> {
  const sessionId = randomUUID();
  await t.db.query(
    `INSERT INTO provider_sessions
       (id, conversation_id, provider, agent_key, session_id, cwd, settings_hash)
     VALUES ($1, $2, 'claude', 'chat:chat', $3, '/work', 'h')`,
    [randomUUID(), conversationId, sessionId],
  );
  return sessionId;
}

async function closed(sessionId: string): Promise<boolean> {
  const { rows } = await t.db.query<{ closed: boolean }>(
    'SELECT closed_at IS NOT NULL AS closed FROM provider_sessions WHERE session_id = $1',
    [sessionId],
  );
  return rows[0]!.closed;
}

async function settingsOf(conversationId: string) {
  return (await getConversationDetail(t.db, conversationId))?.settings;
}

async function notesOf(conversationId: string) {
  const detail = await getConversationDetail(t.db, conversationId);
  return (detail?.topics ?? []).filter((topic) => topic.kind === 'spark_settings');
}

function edit(update: Record<string, unknown>) {
  return client.send('patch', `/api/teammates/${spark.id}`, update);
}

describe('chats follow their Spark’s agent settings', () => {
  it('applies a new model and mode, closes the session and leaves one line', async () => {
    const conversationId = await linkedChat('succeeded');
    const session = await openSession(conversationId);

    await edit({ model: 'sonnet', agentMode: 'default' });

    expect(await settingsOf(conversationId)).toMatchObject({
      provider: 'claude',
      model: 'sonnet',
      agentMode: 'default',
      level: 'hands-off',
    });
    expect(await closed(session)).toBe(true);
    expect(await notesOf(conversationId)).toMatchObject([{ name: 'Bolt' }]);
  });

  it('follows even when the user changed the chat’s model by hand', async () => {
    const conversationId = await linkedChat('succeeded');
    await updateChatSettings(t.db, conversationId, { model: 'haiku' });

    await edit({ model: 'sonnet' });

    expect((await settingsOf(conversationId))?.model).toBe('sonnet');
  });

  it('leaves the autonomy level and the projects of a chat alone', async () => {
    const conversationId = await linkedChat('succeeded');
    await updateChatSettings(t.db, conversationId, { level: 'full-auto' });
    const session = await openSession(conversationId);

    await edit({ level: 'hands-off', role: 'Fixer' });

    expect((await settingsOf(conversationId))?.level).toBe('full-auto');
    expect(await notesOf(conversationId)).toEqual([]);
    expect(await closed(session)).toBe(true);
  });

  it('skips a chat with a turn running or queued', async () => {
    const running = await linkedChat('running');
    const queued = await linkedChat('queued');

    await edit({ model: 'sonnet' });

    expect((await settingsOf(running))?.model).toBe('opus');
    expect((await settingsOf(queued))?.model).toBe('opus');
    expect(await notesOf(running)).toEqual([]);
  });

  it('skips an archived chat', async () => {
    const conversationId = await linkedChat('succeeded');
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [
      conversationId,
    ]);

    await edit({ model: 'sonnet' });

    expect((await settingsOf(conversationId))?.model).toBe('opus');
    expect(await notesOf(conversationId)).toEqual([]);
  });

  it('updates a chat with no message yet without a line', async () => {
    const conversationId = await linkedChat(null);

    await edit({ model: 'sonnet' });

    expect((await settingsOf(conversationId))?.model).toBe('sonnet');
    expect(await notesOf(conversationId)).toEqual([]);
  });

  it('goes back to the user’s defaults when the Spark stops naming an agent', async () => {
    const conversationId = await linkedChat('succeeded');

    await edit({ provider: null, model: null, agentMode: null });

    const settings = await settingsOf(conversationId);
    expect(settings?.model).not.toBe('opus');
    expect(settings?.agentMode).not.toBe('plan');
    expect(settings?.level).toBe('hands-off');
  });

  it('leaves chats of a deleted Spark as they were', async () => {
    const conversationId = await linkedChat('succeeded');

    await client.send('delete', `/api/teammates/${spark.id}`);

    expect((await settingsOf(conversationId))?.model).toBe('opus');
    expect((await edit({ model: 'sonnet' })).status).toBe(404);
  });
});
