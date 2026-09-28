import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, POOL_MAX, type Db } from '../src/persistence/db.ts';
import { resolveChatSettings } from '../src/persistence/chat-settings.ts';
import {
  createConversation,
  ensureLocalWorkspace,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { migrationsDir, runMigrations } from '../src/persistence/migrate.ts';
import { getRun } from '../src/persistence/runs.ts';
import { getSetupState, saveConnection } from '../src/persistence/setup.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, testDatabaseUrl, type TestDb } from './support.ts';

const LEVELS_MIGRATION = '0049_levels_full_auto_ship.sql';

async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

describe('removing Hands-on', () => {
  let schema: string;
  let db: Db;
  let before: string;

  beforeEach(async () => {
    schema = `test_${randomUUID().replaceAll('-', '')}`;
    await admin(`CREATE SCHEMA ${schema}`);
    db = createDb(testDatabaseUrl(), { searchPath: schema, max: POOL_MAX.test });
    before = await mkdtemp(path.join(tmpdir(), 'spark-migrations-'));
    for (const name of await readdir(migrationsDir)) {
      if (name.endsWith('.sql') && name < LEVELS_MIGRATION) {
        await cp(path.join(migrationsDir, name), path.join(before, name));
      }
    }
    await runMigrations(db, { dir: before });
  });

  afterEach(async () => {
    await db.end();
    await admin(`DROP SCHEMA ${schema} CASCADE`);
    await rm(before, { recursive: true, force: true });
  });

  it('turns stored Hands-on chats, defaults and runs into Ask before edits', async () => {
    const workspaceId = await ensureLocalWorkspace(db);
    await saveConnection(db, workspaceId, 'claude', {
      method: 'cli',
      detail: 'claude 1.0',
      summary: '',
      models: [],
    });
    await db.query(
      `UPDATE provider_connections SET permission = 'do', level = 'hands-on' WHERE workspace_id = $1`,
      [workspaceId],
    );
    const conversation = await createConversation(db, workspaceId, randomUUID());
    await db.query('UPDATE conversations SET overrides = $2 WHERE id = $1', [
      conversation.id,
      JSON.stringify({
        claude: { permission: 'do', level: 'hands-on', model: 'sonnet' },
        codex: { level: 'hands-off' },
      }),
    ]);
    const sent = await sendUserMessage(
      db,
      conversation.id,
      { id: randomUUID(), content: 'go' },
      { provider: 'fake', permission: 'do', level: 'balanced' },
    );
    await db.query(`UPDATE runs SET level = 'hands-on' WHERE id = $1`, [sent.run.id]);

    await runMigrations(db);

    const { rows } = await db.query<{ level: string }>(
      'SELECT level FROM provider_connections WHERE workspace_id = $1',
      [workspaceId],
    );
    expect(rows).toEqual([{ level: 'balanced' }]);
    const overrides = await db.query<{ overrides: unknown }>(
      'SELECT overrides FROM conversations WHERE id = $1',
      [conversation.id],
    );
    expect(overrides.rows[0]!.overrides).toEqual({
      claude: { permission: 'do', level: 'balanced', model: 'sonnet' },
      codex: { level: 'hands-off' },
    });
    expect((await getRun(db, sent.run.id))?.level).toBe('balanced');
    expect(await resolveChatSettings(db, conversation.id)).toMatchObject({
      permission: 'do',
      level: 'balanced',
    });
    const setup = await getSetupState(db, workspaceId);
    expect(setup.providers.find((entry) => entry.id === 'claude')?.connection?.level).toBe(
      'balanced',
    );
    expect(setup.profile.shipFailingChecks).toBe(true);
    await expect(
      db.query(`UPDATE runs SET level = 'hands-on' WHERE id = $1`, [sent.run.id]),
    ).rejects.toThrow(/runs_level_check/);
    await expect(
      db.query(`UPDATE provider_connections SET level = 'hands-on' WHERE workspace_id = $1`, [
        workspaceId,
      ]),
    ).rejects.toThrow(/provider_connections_level_check/);
  });
});

describe('the four permission choices through the API', () => {
  let t: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    t = await createTestDb();
    app = createTestApp(t, { fixedRunProvider: null });
    await saveConnection(t.db, t.workspaceId, 'claude', {
      method: 'cli',
      detail: 'claude 1.0',
      summary: '',
      models: [],
    });
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const patch = (url: string, body: object) =>
    request(app).patch(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

  it('sets Do and the level in one change, and reads an old Hands-on request as Ask before edits', async () => {
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const url = `/api/conversations/${id}/settings`;
    const auto = await patch(url, { permission: 'do', level: 'hands-off' }).expect(200);
    expect(auto.body).toMatchObject({ permission: 'do', level: 'hands-off' });
    const asked = await patch(url, { permission: 'ask' }).expect(200);
    expect(asked.body).toMatchObject({ permission: 'ask', level: 'hands-off' });
    const legacy = await patch(url, { permission: 'do', level: 'hands-on' }).expect(200);
    expect(legacy.body).toMatchObject({ permission: 'do', level: 'balanced' });
  });

  it('saves the "open a draft PR when checks fail" setting', async () => {
    const put = (body: object) =>
      request(app).patch('/api/profile').set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
    const saved = await put({ shipFailingChecks: false });
    expect([200, 204]).toContain(saved.status);
    expect((await getSetupState(t.db, t.workspaceId)).profile.shipFailingChecks).toBe(false);
  });
});
