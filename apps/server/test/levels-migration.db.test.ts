import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveChatSettings } from '../src/persistence/chat-settings.ts';
import { createConversation, ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { getRun } from '../src/persistence/runs.ts';
import { getSetupState } from '../src/persistence/setup.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { migratedUpTo, oldConnection, oldConversation } from './migration-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

const LEVELS_MIGRATION = '0049_levels_full_auto_ship.sql';
const MODES_MIGRATION = '0050_provider_modes.sql';

describe('removing Hands-on', () => {
  const state = migratedUpTo(LEVELS_MIGRATION);

  it('turns stored Hands-on chats, defaults and runs into Review each step', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await oldConnection(db, workspaceId, 'claude', 'do', 'hands-on');
    const conversation = await oldConversation(db, workspaceId);
    await db.query('UPDATE conversations SET overrides = $2 WHERE id = $1', [
      conversation.id,
      JSON.stringify({
        claude: { permission: 'do', level: 'hands-on', model: 'sonnet' },
        codex: { level: 'hands-off' },
      }),
    ]);
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', 'go')
       RETURNING id`,
      [randomUUID(), conversation.id],
    );
    const runId = randomUUID();
    await db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, mode, level)
       VALUES ($1, $2, $3, 'fake', 'succeeded', 'do', 'hands-on')`,
      [runId, conversation.id, inserted.rows[0]!.id],
    );

    await runMigrations(db);

    const { rows } = await db.query<{ default_level: string }>(
      'SELECT default_level FROM profiles WHERE workspace_id = $1',
      [workspaceId],
    );
    expect(rows).toEqual([{ default_level: 'balanced' }]);
    const overrides = await db.query<{ overrides: unknown }>(
      'SELECT overrides FROM conversations WHERE id = $1',
      [conversation.id],
    );
    expect(overrides.rows[0]!.overrides).toEqual({
      claude: { level: 'balanced', model: 'sonnet', agentMode: 'default' },
      codex: { level: 'hands-off', agentMode: 'read-only' },
    });
    expect((await getRun(db, runId))?.level).toBe('balanced');
    expect(await resolveChatSettings(db, conversation.id)).toMatchObject({
      permission: 'do',
      level: 'balanced',
    });
    const setup = await getSetupState(db, workspaceId);
    expect(setup.profile.defaultLevel).toBe('balanced');
    expect(setup.profile.shipFailingChecks).toBe(true);
    await expect(
      db.query(`UPDATE runs SET level = 'hands-on' WHERE id = $1`, [runId]),
    ).rejects.toThrow(/runs_level_check/);
    await expect(
      db.query(`UPDATE profiles SET default_level = 'hands-on' WHERE workspace_id = $1`, [
        workspaceId,
      ]),
    ).rejects.toThrow(/profiles_default_level_check/);
  });
});

describe('provider modes from the old permission levels (migration 0050)', () => {
  const state = migratedUpTo(MODES_MIGRATION);

  it('maps each stored level to the provider mode and keeps it as the autonomy', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await oldConnection(db, workspaceId, 'claude', 'do', 'full-auto');
    await oldConnection(db, workspaceId, 'codex', 'ask', 'balanced');
    await oldConnection(db, workspaceId, 'zai', 'do', 'hands-off');
    const conversation = await oldConversation(db, workspaceId);
    await db.query('UPDATE conversations SET overrides = $2 WHERE id = $1', [
      conversation.id,
      JSON.stringify({
        claude: { permission: 'ask', model: 'sonnet' },
        codex: { permission: 'do', level: 'balanced' },
        zai: { level: 'full-auto' },
      }),
    ]);

    await runMigrations(db);

    const { rows } = await db.query<{ provider: string; agent_mode: string }>(
      'SELECT provider, agent_mode FROM provider_connections ORDER BY provider',
    );
    expect(rows).toEqual([
      { provider: 'claude', agent_mode: 'bypassPermissions' },
      { provider: 'codex', agent_mode: 'read-only' },
      { provider: 'zai', agent_mode: 'acceptEdits' },
    ]);
    const overrides = await db.query<{ overrides: unknown }>(
      'SELECT overrides FROM conversations WHERE id = $1',
      [conversation.id],
    );
    expect(overrides.rows[0]!.overrides).toEqual({
      claude: { model: 'sonnet', agentMode: 'plan' },
      codex: { level: 'balanced', agentMode: 'ask-every-action' },
      zai: { level: 'full-auto', agentMode: 'bypassPermissions' },
    });
    await db.query(`UPDATE conversations SET provider = 'claude' WHERE id = $1`, [conversation.id]);
    expect(await resolveChatSettings(db, conversation.id)).toMatchObject({
      agentMode: 'plan',
      permission: 'ask',
      level: 'balanced',
    });
  });
});

describe('modes and autonomy through the API', () => {
  let t: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    t = await createTestDb();
    app = createTestApp(t, { fixedRunProvider: null });
    await connectCliProvider(t, 'claude');
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const patch = (url: string, body: object) =>
    request(app).patch(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

  it('sets the mode and the autonomy in one change, and reads an old Hands-on level as Review each step', async () => {
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const url = `/api/conversations/${id}/settings`;
    const auto = await patch(url, { agentMode: 'acceptEdits', level: 'hands-off' }).expect(200);
    expect(auto.body).toMatchObject({
      permission: 'do',
      agentMode: 'acceptEdits',
      level: 'hands-off',
    });
    const asked = await patch(url, { agentMode: 'plan' }).expect(200);
    expect(asked.body).toMatchObject({ permission: 'ask', agentMode: 'plan', level: 'hands-off' });
    const legacy = await patch(url, { agentMode: 'default', level: 'hands-on' }).expect(200);
    expect(legacy.body).toMatchObject({ permission: 'do', level: 'balanced' });
    await patch(url, { permission: 'do' }).expect(400);
  });

  it('saves the "open a draft PR when checks fail" setting', async () => {
    const put = (body: object) =>
      request(app).patch('/api/profile').set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
    const saved = await put({ shipFailingChecks: false });
    expect([200, 204]).toContain(saved.status);
    expect((await getSetupState(t.db, t.workspaceId)).profile.shipFailingChecks).toBe(false);
  });
});
