import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRunTarget } from '../src/api/run-target.ts';
import {
  resolveChatSettings,
  saveCapabilities,
  updateChatSettings,
} from '../src/persistence/chat-settings.ts';
import { createConversation, ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { createTestApp, localClient } from './app-support.ts';
import { migratedUpTo } from './migration-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

const NO_AUTO_MIGRATION = '0191_no_auto_model.sql';

const CLAUDE_MODELS = [
  { id: 'default', label: 'Default (recommended)', description: 'Opus 5.5' },
  { id: 'opus', label: 'Opus 5.5', description: null },
  { id: 'sonnet', label: 'Sonnet 5.5', description: null },
  { id: 'haiku', label: 'Haiku 5.5', description: null },
];

async function oldChat(
  db: Db,
  workspaceId: string,
  routing: 'auto' | 'pinned',
  overrides: object,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO conversations (id, workspace_id, title, provider, overrides, model_routing)
     VALUES ($1, $2, 'Old chat', 'claude', $3, $4)`,
    [id, workspaceId, JSON.stringify(overrides), routing],
  );
  return id;
}

async function storedRouting(db: Db, schema: string) {
  const chats = await db.query<{ model_routing: string }>(
    'SELECT DISTINCT model_routing FROM conversations',
  );
  const defaults = await db.query<{ name: string; value: string }>(
    `SELECT table_name || '.' || column_name AS name, column_default AS value
     FROM information_schema.columns
     WHERE table_schema = $1
       AND ((table_name = 'conversations' AND column_name = 'model_routing')
         OR (table_name = 'orchestrations' AND column_name = 'routing'))
     ORDER BY 1`,
    [schema],
  );
  return { chats: chats.rows.map((row) => row.model_routing), defaults: defaults.rows };
}

describe('upgrading chats off Auto', () => {
  const state = migratedUpTo(NO_AUTO_MIGRATION);

  it('moves an Auto chat to the default model and keeps a picked model', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const auto = await oldChat(db, workspaceId, 'auto', {
      claude: { model: 'haiku', effort: 'high' },
      codex: { model: 'gpt-6-sol' },
    });
    const pinned = await oldChat(db, workspaceId, 'pinned', { claude: { model: 'haiku' } });
    const untouched = await oldChat(db, workspaceId, 'auto', {});

    await runMigrations(db);
    await saveConnection(db, workspaceId, 'claude', {
      method: 'cli',
      detail: 'claude 1.0',
      summary: '',
      models: [],
    });
    await db.query(`UPDATE provider_connections SET model = 'sonnet' WHERE provider = 'claude'`);

    const { rows } = await db.query<{ id: string; overrides: object }>(
      'SELECT id, overrides FROM conversations WHERE id = ANY($1)',
      [[auto, pinned]],
    );
    const overridesOf = (id: string) => rows.find((row) => row.id === id)?.overrides;
    expect(overridesOf(auto)).toEqual({ claude: { effort: 'high' }, codex: {} });
    expect(overridesOf(pinned)).toEqual({ claude: { model: 'haiku' } });
    expect(await resolveChatSettings(db, auto)).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect((await resolveChatSettings(db, pinned)).model).toBe('haiku');
    expect((await resolveChatSettings(db, untouched)).model).toBe('sonnet');
    expect(await storedRouting(db, state.schema)).toEqual({
      chats: ['pinned'],
      defaults: [
        { name: 'conversations.model_routing', value: "'pinned'::text" },
        { name: 'orchestrations.routing', value: "'pinned'::text" },
      ],
    });
  });
});

describe('a chat always names a model', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await connectCliProvider(t, 'claude');
    await saveCapabilities(t.db, t.workspaceId, {
      provider: 'claude',
      models: CLAUDE_MODELS,
      efforts: [],
      defaultModel: 'default',
    });
  });

  afterEach(async () => {
    await t.cleanup();
  });

  async function newChat(): Promise<string> {
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    return id;
  }

  const usedModel = async (chat: string) =>
    (await resolveRunTarget({ db: t.db, workspaceId: t.workspaceId }, chat)).model;

  it('starts new chats on the Settings default and follows a change to it', async () => {
    const client = localClient(createTestApp(t, { fixedRunProvider: null }));
    await client.send('patch', '/api/providers/claude/defaults', { model: 'sonnet' }).expect(200);
    const first = await newChat();
    const defaults = await client.get('/api/chat-settings/defaults').expect(200);
    expect(defaults.body.model).toBe('sonnet');
    expect(defaults.body).not.toHaveProperty('routing');
    expect(await usedModel(first)).toBe('sonnet');

    await client.send('patch', '/api/providers/claude/defaults', { model: 'haiku' }).expect(200);
    const second = await newChat();
    const detail = await client.get(`/api/conversations/${second}`).expect(200);
    expect(detail.body.settings.model).toBe('haiku');
    expect(detail.body.settings).not.toHaveProperty('routing');
    expect(await usedModel(second)).toBe('haiku');
    expect(await usedModel(first)).toBe('haiku');
  });

  it('runs the model a chat picked and goes back to the default when the pick is cleared', async () => {
    const id = await newChat();
    const agentDefault = await usedModel(id);
    expect(agentDefault).not.toBeNull();

    await updateChatSettings(t.db, id, { model: 'opus' });
    expect(await usedModel(id)).toBe('opus');
    await updateChatSettings(t.db, id, { model: null });
    expect(await usedModel(id)).toBe(agentDefault);
  });

  it('refuses a request that only asks for Auto', async () => {
    const id = await newChat();
    const client = localClient(createTestApp(t, { fixedRunProvider: null }));
    await client
      .send('patch', `/api/conversations/${id}/settings`, { routing: 'auto' })
      .expect(400);
  });
});
