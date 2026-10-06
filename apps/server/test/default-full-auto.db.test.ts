import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveChatSettings } from '../src/persistence/chat-settings.ts';
import { createConversation, ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { getSetupState, saveConnection } from '../src/persistence/setup.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { createTestApp, localClient } from './app-support.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';

const MIGRATION = '0133_default_full_auto.sql';

describe('Full auto → PR becomes the default (migration 0133)', () => {
  const state = migratedUpTo(MIGRATION);

  async function install(onboarded: boolean): Promise<string> {
    const workspaceId = await ensureLocalWorkspace(state.db);
    await state.db.query('INSERT INTO profiles (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      workspaceId,
    ]);
    await saveConnection(state.db, workspaceId, 'claude', {
      method: 'cli',
      detail: 'claude 1.0',
      summary: '',
      models: [],
    });
    await saveConnection(state.db, workspaceId, 'codex', {
      method: 'cli',
      detail: 'codex 1.0',
      summary: '',
      models: [],
    });
    if (onboarded) {
      await state.db.query(
        'UPDATE profiles SET onboarding_completed_at = now() WHERE workspace_id = $1',
        [workspaceId],
      );
    }
    return workspaceId;
  }

  async function chatWith(workspaceId: string, overrides: object): Promise<string> {
    const { id } = await oldConversation(state.db, workspaceId);
    await state.db.query('UPDATE conversations SET overrides = $2 WHERE id = $1', [
      id,
      JSON.stringify(overrides),
    ]);
    return id;
  }

  const levelOf = async (id: string) => (await resolveChatSettings(state.db, id)).level;

  it('moves the stored default, leaves every existing chat at its level, and gives new chats the new default', async () => {
    const workspaceId = await install(true);
    const untouched = await chatWith(workspaceId, {});
    const pickedModel = await chatWith(workspaceId, { claude: { model: 'sonnet' } });
    const pickedFullAuto = await chatWith(workspaceId, { claude: { level: 'full-auto' } });
    const before = await Promise.all([untouched, pickedModel, pickedFullAuto].map(levelOf));
    expect(before).toEqual(['hands-off', 'hands-off', 'full-auto']);

    await runMigrations(state.db);

    expect(await Promise.all([untouched, pickedModel, pickedFullAuto].map(levelOf))).toEqual(
      before,
    );
    const stored = await state.db.query<{ overrides: Record<string, { level?: string }> }>(
      'SELECT overrides FROM conversations WHERE id = $1',
      [pickedModel],
    );
    expect(stored.rows[0]!.overrides).toEqual({
      claude: { model: 'sonnet', level: 'hands-off' },
      codex: { level: 'hands-off' },
      zai: { level: 'hands-off' },
    });
    await state.db.query(`UPDATE conversations SET provider = 'codex' WHERE id = $1`, [untouched]);
    expect(await levelOf(untouched)).toBe('hands-off');

    const setup = await getSetupState(state.db, workspaceId);
    expect(setup.profile).toMatchObject({ defaultLevel: 'full-auto', defaultLevelNotice: true });
    const fresh = randomUUID();
    await createConversation(state.db, workspaceId, fresh);
    expect(await levelOf(fresh)).toBe('full-auto');
  });

  it('keeps a Spark’s own level and leaves an inheriting one to follow the default', async () => {
    const workspaceId = await install(true);
    const explicit = randomUUID();
    const inheriting = randomUUID();
    await state.db.query(
      `INSERT INTO teammates (id, workspace_id, name, face_shape, face_color, level)
       VALUES ($1, $3, 'Ada', 'round', 'blue', 'hands-off'), ($2, $3, 'Bolt', 'round', 'blue', NULL)`,
      [explicit, inheriting, workspaceId],
    );

    await runMigrations(state.db);

    const { rows } = await state.db.query<{ name: string; level: string | null }>(
      'SELECT name, level FROM teammates WHERE workspace_id = $1 ORDER BY name',
      [workspaceId],
    );
    expect(rows).toEqual([
      { name: 'Ada', level: 'hands-off' },
      { name: 'Bolt', level: null },
    ]);
  });

  it('leaves an install that already chose Full auto → PR alone, with no notice', async () => {
    const workspaceId = await install(true);
    await state.db.query(
      `UPDATE profiles SET default_level = 'full-auto' WHERE workspace_id = $1`,
      [workspaceId],
    );
    const chat = await chatWith(workspaceId, {});

    await runMigrations(state.db);

    expect(await levelOf(chat)).toBe('full-auto');
    const stored = await state.db.query<{ overrides: object }>(
      'SELECT overrides FROM conversations WHERE id = $1',
      [chat],
    );
    expect(stored.rows[0]!.overrides).toEqual({});
    const setup = await getSetupState(state.db, workspaceId);
    expect(setup.profile).toMatchObject({ defaultLevel: 'full-auto', defaultLevelNotice: false });
  });

  it('shows no notice to an install that had not finished setup', async () => {
    const workspaceId = await install(false);

    await runMigrations(state.db);

    const { rows } = await state.db.query<{ default_level: string; default_level_notice: boolean }>(
      'SELECT default_level, default_level_notice FROM profiles WHERE workspace_id = $1',
      [workspaceId],
    );
    expect(rows).toEqual([{ default_level: 'full-auto', default_level_notice: false }]);
  });
});

describe('the default autonomy on a new install', () => {
  let t: TestDb;
  let client: ReturnType<typeof localClient>;

  beforeEach(async () => {
    t = await createTestDb();
    client = localClient(createTestApp(t, { fixedRunProvider: null }));
    await connectCliProvider(t, 'claude');
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const profile = async () => (await client.get('/api/setup').expect(200)).body.profile;
  const draftLevel = async () =>
    (await client.get('/api/chat-settings/defaults').expect(200)).body.level;

  it('starts new chats at Full auto → PR with no notice', async () => {
    expect(await profile()).toMatchObject({ defaultLevel: 'full-auto', defaultLevelNotice: false });
    expect(await draftLevel()).toBe('full-auto');
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    expect((await resolveChatSettings(t.db, id)).level).toBe('full-auto');
  });

  it('switches the default back to Automatic in one change, for new chats and chats without a pick', async () => {
    const picked = randomUUID();
    await createConversation(t.db, t.workspaceId, picked);
    await client
      .send('patch', `/api/conversations/${picked}/settings`, { level: 'full-auto' })
      .expect(200);

    const saved = await client.send('patch', '/api/profile', { defaultLevel: 'hands-off' });
    expect(saved.status).toBe(200);

    expect(await draftLevel()).toBe('hands-off');
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    expect((await resolveChatSettings(t.db, id)).level).toBe('hands-off');
    expect((await resolveChatSettings(t.db, picked)).level).toBe('full-auto');
  });

  it('dismisses the notice once, and changing the default dismisses it too', async () => {
    const show = () =>
      t.db.query('UPDATE profiles SET default_level_notice = true WHERE workspace_id = $1', [
        t.workspaceId,
      ]);
    await profile();
    await show();
    expect((await profile()).defaultLevelNotice).toBe(true);
    await client.send('patch', '/api/profile', { displayName: 'Ada' }).expect(200);
    expect((await profile()).defaultLevelNotice).toBe(true);

    await client.send('patch', '/api/profile', { defaultLevelNotice: false }).expect(200);
    expect((await profile()).defaultLevelNotice).toBe(false);
    await client.send('patch', '/api/profile', { defaultLevelNotice: true }).expect(400);

    await show();
    await client.send('patch', '/api/profile', { defaultLevel: 'hands-off' }).expect(200);
    expect(await profile()).toMatchObject({ defaultLevel: 'hands-off', defaultLevelNotice: false });
  });

  it('reads a turn that stored no level as Automatic, so a question or plan turn never ships', async () => {
    const { runId } = await startChat(t, 'What does the divider do?');
    const stored = await t.db.query<{ level: string | null }>(
      'SELECT level FROM runs WHERE id = $1',
      [runId],
    );
    expect(stored.rows[0]!.level).toBeNull();
    expect((await loadRunInput(t.db, runId)).level).toBe('hands-off');
  });
});
