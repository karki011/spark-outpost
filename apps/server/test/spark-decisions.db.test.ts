import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draftChatSettings, resolveChatSettings } from '../src/persistence/chat-settings.ts';
import { createConversation, ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { getSetupState, sparkPreferences, updateProfile } from '../src/persistence/setup.ts';
import { createTestApp, localClient } from './app-support.ts';
import { migratedUpTo, oldConnection } from './migration-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

const DECISIONS_MIGRATION = '0058_spark_decisions.sql';

async function otherWorkspace(db: Db): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, 'Other')`, [
    id,
    `other-${id}`,
  ]);
  return id;
}

async function defaultLevel(db: Db, workspaceId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ default_level: string }>(
    'SELECT default_level FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.default_level;
}

describe('the Spark decisions migration', () => {
  const state = migratedUpTo(DECISIONS_MIGRATION);

  it('keeps the most common autonomy of the connected agents as the one default', async () => {
    const { db } = state;
    const local = await ensureLocalWorkspace(db);
    await oldConnection(db, local, 'claude', 'do', 'full-auto');
    await oldConnection(db, local, 'codex', 'ask', 'full-auto');
    await oldConnection(db, local, 'zai', 'do', 'balanced');
    await db.query(`INSERT INTO profiles (workspace_id, display_name) VALUES ($1, 'Hazel')`, [
      local,
    ]);
    const tied = await otherWorkspace(db);
    await oldConnection(db, tied, 'claude', 'do', 'balanced');
    await oldConnection(db, tied, 'codex', 'do', 'hands-off');
    await db.query(`INSERT INTO profiles (workspace_id, default_provider) VALUES ($1, 'codex')`, [
      tied,
    ]);
    const unprofiled = await otherWorkspace(db);
    await oldConnection(db, unprofiled, 'claude', 'do', 'balanced');
    await oldConnection(db, unprofiled, 'codex', 'do', 'full-auto');
    await db.query(
      `UPDATE provider_connections SET disconnected_at = now()
       WHERE workspace_id = $1 AND provider = 'codex'`,
      [unprofiled],
    );

    await runMigrations(db);

    expect(await defaultLevel(db, local)).toBe('full-auto');
    expect(await defaultLevel(db, tied)).toBe('hands-off');
    expect(await defaultLevel(db, unprofiled)).toBe('balanced');
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'provider_connections' AND column_name = 'level'`,
      [state.schema],
    );
    expect(rows).toEqual([]);
    expect((await getSetupState(db, local)).profile).toMatchObject({
      displayName: 'Hazel',
      defaultLevel: 'full-auto',
      spendCapUsd: null,
      morningBrief: true,
      morningBriefTime: '07:00',
    });
  });

  it('starts a workspace with no agents on Automatic', async () => {
    const { db } = state;
    const local = await ensureLocalWorkspace(db);
    await runMigrations(db);
    expect((await getSetupState(db, local)).profile.defaultLevel).toBe('hands-off');
  });
});

describe('Spark decision settings', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await connectCliProvider(t, 'claude');
    await connectCliProvider(t, 'codex');
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('saves each setting through the profile API and rejects bad values', async () => {
    const { get, send } = localClient(createTestApp(t));
    const { body } = await send('patch', '/api/profile', {
      defaultLevel: 'full-auto',
      spendCapUsd: 2.5,
      morningBrief: false,
      morningBriefTime: '08:30',
    }).expect(200);
    expect(body.profile).toMatchObject({
      defaultLevel: 'full-auto',
      spendCapUsd: 2.5,
      morningBrief: false,
      morningBriefTime: '08:30',
    });
    await send('patch', '/api/profile', { morningBriefTime: '25:00' }).expect(400);
    await send('patch', '/api/profile', { spendCapUsd: 0 }).expect(400);
    await send('patch', '/api/profile', { defaultLevel: 'reckless' }).expect(400);
    const { body: after } = await get('/api/setup').expect(200);
    expect(after.profile).toMatchObject({ morningBriefTime: '08:30', spendCapUsd: 2.5 });
  });

  it('uses the server cap until you pick one, and Off beats the server cap', async () => {
    const { get, send } = localClient(createTestApp(t, { serverSpendCapUsd: 5 }));
    expect((await get('/api/setup').expect(200)).body.profile.spendCapUsd).toBe(5);
    expect((await sparkPreferences(t.db, t.workspaceId)).savedSpendCapUsd).toBeNull();
    await send('patch', '/api/profile', { spendCapUsd: null }).expect(200);
    expect((await get('/api/setup').expect(200)).body.profile.spendCapUsd).toBeNull();
    expect((await sparkPreferences(t.db, t.workspaceId)).savedSpendCapUsd).toBe(0);
    await send('patch', '/api/profile', { spendCapUsd: 1.25 }).expect(200);
    expect((await get('/api/setup').expect(200)).body.profile.spendCapUsd).toBe(1.25);
  });

  it('gives new chats the one default autonomy and keeps a chat’s own pick', async () => {
    expect((await draftChatSettings(t.db, t.workspaceId)).level).toBe('hands-off');
    await updateProfile(t.db, t.workspaceId, { defaultLevel: 'balanced' });
    expect((await draftChatSettings(t.db, t.workspaceId)).level).toBe('balanced');
    const picked = await createConversation(t.db, t.workspaceId, randomUUID());
    await t.db.query('UPDATE conversations SET overrides = $2 WHERE id = $1', [
      picked.id,
      JSON.stringify({ claude: { level: 'full-auto' } }),
    ]);
    const fresh = await createConversation(t.db, t.workspaceId, randomUUID());
    await t.db.query(`UPDATE conversations SET provider = 'codex' WHERE id = $1`, [fresh.id]);
    expect((await resolveChatSettings(t.db, picked.id)).level).toBe('full-auto');
    expect((await resolveChatSettings(t.db, fresh.id)).level).toBe('balanced');
  });

  it('no longer takes an autonomy level per agent', async () => {
    const { send } = localClient(createTestApp(t));
    const { body } = await send('patch', '/api/providers/claude/defaults', {
      level: 'full-auto',
    }).expect(200);
    expect(body.providers[0].connection).not.toHaveProperty('level');
    expect(body.profile.defaultLevel).toBe('hands-off');
  });
});
