import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assistantSettingsViewSchema, sparkAssistantSchema } from '@spark-outpost/contracts';
import { resolveChatSettings, updateChatSettings } from '../src/persistence/chat-settings.ts';
import { createTestApp, localClient } from './app-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;

const MODELS = {
  claude: [
    { id: 'haiku', label: 'Haiku 5.5', description: null },
    { id: 'sonnet', label: 'Sonnet 5.5', description: null },
    { id: 'opus[1m]', label: 'Opus 5.5', description: null },
  ],
  codex: [
    { id: 'gpt-6-sol', label: '6 Sol', description: null },
    { id: 'gpt-6-luna', label: '6 Luna', description: null },
  ],
};
const EFFORTS = ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null }));

async function capture(provider: 'claude' | 'codex', models: object[], defaultModel: string) {
  await t.db.query(
    `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET models = EXCLUDED.models`,
    [t.workspaceId, provider, JSON.stringify(models), JSON.stringify(EFFORTS), defaultModel],
  );
}

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
  await connectCliProvider(t, 'codex');
  await capture('claude', MODELS.claude, 'opus[1m]');
  await capture('codex', MODELS.codex, 'gpt-6-sol');
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Test User', 'claude', now())`,
    [t.workspaceId],
  );
});

afterEach(async () => {
  await t.cleanup();
});

function api() {
  return localClient(createTestApp(t, { fixedRunProvider: null }));
}

async function assistantId(): Promise<string> {
  const response = await api().send('post', '/api/spark-assistant');
  expect(response.status).toBe(200);
  return sparkAssistantSchema.parse(response.body).conversationId;
}

async function view() {
  const response = await api().get('/api/spark-assistant/settings');
  expect(response.status).toBe(200);
  return assistantSettingsViewSchema.parse(response.body);
}

async function save(settings: object) {
  return api().send('put', '/api/spark-assistant/settings', settings);
}

const FAST = { provider: null, modelChoice: 'fast', model: null, effort: null };

async function settingsOf(id: string) {
  const settings = await resolveChatSettings(t.db, id);
  return {
    provider: settings.provider,
    model: settings.model,
    effort: settings.effort,
  };
}

describe('Spark assistant settings', () => {
  it('defaults to the fast tier and runs the hidden chat on Sonnet 5.5 at low effort', async () => {
    const id = await assistantId();
    expect((await view()).settings).toEqual(FAST);
    expect((await view()).runsOn).toEqual({
      provider: 'claude',
      model: 'sonnet',
      modelLabel: 'Sonnet 5.5',
      effort: 'low',
      fastEffort: 'low',
      noFastModel: false,
    });
    expect(await settingsOf(id)).toEqual({
      provider: 'claude',
      model: 'sonnet',
      effort: 'low',
    });
  });

  it('saves the setting in the profile and applies it to the chat at once', async () => {
    const id = await assistantId();
    const picked = { provider: 'codex', modelChoice: 'pick', model: 'gpt-6-sol', effort: 'high' };
    expect((await save(picked)).status).toBe(200);
    expect((await view()).settings).toEqual(picked);
    expect(await settingsOf(id)).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'high',
    });

    expect((await save({ ...FAST, modelChoice: 'default' })).status).toBe(200);
    expect(await settingsOf(id)).toMatchObject({ provider: 'claude' });
    expect((await resolveChatSettings(t.db, id)).model).not.toBe('sonnet');
  });

  it('keeps a change made inside the chat until the setting changes', async () => {
    const id = await assistantId();
    await updateChatSettings(t.db, id, { model: 'haiku', effort: 'medium' });
    expect(await assistantId()).toBe(id);
    expect(await settingsOf(id)).toMatchObject({ model: 'haiku', effort: 'medium' });

    await save({ ...FAST, effort: 'high' });
    expect(await settingsOf(id)).toMatchObject({ model: 'sonnet', effort: 'high' });
  });

  it('picks the new provider’s fast tier when the default provider changes', async () => {
    const id = await assistantId();
    await t.db.query(`UPDATE profiles SET default_provider = 'codex' WHERE workspace_id = $1`, [
      t.workspaceId,
    ]);
    await assistantId();
    expect(await settingsOf(id)).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-luna',
      effort: 'low',
    });
    expect((await view()).runsOn).toMatchObject({ provider: 'codex', modelLabel: 'GPT-6 Luna' });
  });

  it('says so and keeps the default model when the provider offers no fast model', async () => {
    await capture('claude', [{ id: 'opus[1m]', label: 'Opus 5.5', description: null }], 'opus[1m]');
    const id = await assistantId();
    expect((await view()).runsOn).toMatchObject({ model: null, noFastModel: true, effort: 'low' });
    expect(await settingsOf(id)).toMatchObject({ model: null, effort: 'low' });
  });

  it('refuses a provider that is not connected and a pick without a model', async () => {
    await t.db.query(
      `UPDATE provider_connections SET disconnected_at = now()
       WHERE workspace_id = $1 AND provider = 'codex'`,
      [t.workspaceId],
    );
    expect((await save({ ...FAST, provider: 'codex' })).status).toBe(400);
    expect((await save({ ...FAST, modelChoice: 'pick' })).status).toBe(400);
    expect((await save({ ...FAST, modelChoice: 'bogus' })).status).toBe(400);
  });

  it('records a settings change for the audit of the next turn', async () => {
    await assistantId();
    await save({ ...FAST, effort: 'medium' });
    const { rows } = await t.db.query<{ kind: string; detail: string; audited: boolean }>(
      'SELECT kind, detail, audited FROM assistant_events WHERE workspace_id = $1',
      [t.workspaceId],
    );
    expect(rows).toEqual([
      { kind: 'settings_changed', detail: 'Claude · Sonnet 5.5 · medium effort', audited: false },
    ]);
  });
});

describe('the hidden Ask Spark chat', () => {
  async function withMessage(id: string) {
    await t.db.query(
      `INSERT INTO messages (id, conversation_id, role, content)
       VALUES (gen_random_uuid(), $1, 'user', 'remember the word pineapple')`,
      [id],
    );
  }

  it('stays out of the chat list and search but opens by its link', async () => {
    const id = await assistantId();
    await withMessage(id);
    const list = await api().get('/api/conversations');
    expect(list.body.map((chat: { id: string }) => chat.id)).not.toContain(id);
    const search = await api().get('/api/conversations?q=pineapple');
    expect(search.body).toEqual([]);
    const opened = await api().get(`/api/conversations/${id}`);
    expect(opened.status).toBe(200);
    expect(opened.body.conversation).toMatchObject({ id, assistant: true });
  });

  it('clears its history and keeps the key facts unless asked', async () => {
    await assistantId();
    await t.db.query(
      `INSERT INTO assistant_facts (id, workspace_id, text) VALUES (gen_random_uuid(), $1, 'x')`,
      [t.workspaceId],
    );
    const kept = await api().send('post', '/api/spark-assistant/clear', { facts: false });
    expect(assistantSettingsViewSchema.parse(kept.body).facts).toHaveLength(1);
    const cleared = await api().send('post', '/api/spark-assistant/clear', { facts: true });
    expect(assistantSettingsViewSchema.parse(cleared.body).facts).toEqual([]);
    const { rows } = await t.db.query<{ kind: string; detail: string }>(
      'SELECT kind, detail FROM assistant_events WHERE workspace_id = $1 ORDER BY at',
      [t.workspaceId],
    );
    expect(rows).toEqual([
      { kind: 'history_cleared', detail: 'key facts kept' },
      { kind: 'history_cleared', detail: 'key facts cleared too' },
    ]);
  });

  it('refuses Clear history while a question is queued or answered, then clears after', async () => {
    const id = await assistantId();
    const sent = await api().send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Who needs me?',
    });
    expect(sent.status).toBe(201);
    expect((await view()).busy).toBe(true);

    const refused = await api().send('post', '/api/spark-assistant/clear', { facts: false });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('Wait for Ask Spark to finish answering first.');
    const { rows } = await t.db.query<{ cleared: Date | null }>(
      'SELECT assistant_history_from AS cleared FROM profiles WHERE workspace_id = $1',
      [t.workspaceId],
    );
    expect(rows[0]!.cleared).toBeNull();

    await t.db.query(
      `UPDATE runs SET status = 'succeeded', finished_at = now() WHERE conversation_id = $1`,
      [id],
    );
    await t.db.query(
      `INSERT INTO chat_queue (id, conversation_id, content, position)
       VALUES (gen_random_uuid(), $1, 'and what is running?', 1)`,
      [id],
    );
    expect((await api().send('post', '/api/spark-assistant/clear', { facts: false })).status).toBe(
      409,
    );

    await t.db.query('DELETE FROM chat_queue WHERE conversation_id = $1', [id]);
    expect((await view()).busy).toBe(false);
    const cleared = await api().send('post', '/api/spark-assistant/clear', { facts: false });
    expect(cleared.status).toBe(200);
    expect(cleared.body.busy).toBe(false);
  });

  it('removes one key fact and records it', async () => {
    await assistantId();
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO assistant_facts (id, workspace_id, text)
       VALUES (gen_random_uuid(), $1, 'the word pineapple') RETURNING id`,
      [t.workspaceId],
    );
    const removed = await api().send('delete', `/api/spark-assistant/facts/${rows[0]!.id}`);
    expect(assistantSettingsViewSchema.parse(removed.body).facts).toEqual([]);
    const events = await api().get('/api/spark-assistant/events');
    expect(events.body.events).toMatchObject([
      { kind: 'fact_removed', line: 'Key fact removed: the word pineapple' },
    ]);
  });
});
