import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveChatSettings } from '../src/persistence/chat-settings.ts';
import { createConversation, ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { createDb, POOL_MAX, type Db } from '../src/persistence/db.ts';
import { migrationsDir, runMigrations } from '../src/persistence/migrate.ts';
import { getSetupState, saveConnection } from '../src/persistence/setup.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, testDatabaseUrl, type TestDb } from './support.ts';

const RETIRING_MIGRATION = '0051_retiring_defaults.sql';

const claudeModels = [
  { id: 'opus[1m]', label: 'Opus 5.5' },
  { id: 'sonnet', label: 'Sonnet 5' },
  { id: 'haiku', label: 'Haiku 4.5' },
];

const connection = (models = claudeModels) => ({
  method: 'cli' as const,
  detail: 'claude 1.0',
  summary: '',
  models,
});

async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

describe('migrating stored defaults off retiring models', () => {
  let schema: string;
  let db: Db;
  let before: string;

  beforeEach(async () => {
    schema = `test_${randomUUID().replaceAll('-', '')}`;
    await admin(`CREATE SCHEMA ${schema}`);
    db = createDb(testDatabaseUrl(), { searchPath: schema, max: POOL_MAX.test });
    before = await mkdtemp(path.join(tmpdir(), 'spark-migrations-'));
    for (const name of await readdir(migrationsDir)) {
      if (name.endsWith('.sql') && name < RETIRING_MIGRATION) {
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

  it('moves connection defaults to the provider default and keeps per-chat picks', async () => {
    const workspaceId = await ensureLocalWorkspace(db);
    await saveConnection(db, workspaceId, 'claude', connection());
    await saveConnection(db, workspaceId, 'codex', { ...connection([]), detail: 'codex 1.0' });
    await db.query(
      `UPDATE provider_connections SET model = CASE provider
         WHEN 'claude' THEN 'claude-haiku-4-5' ELSE 'gpt-5.5' END
       WHERE workspace_id = $1`,
      [workspaceId],
    );
    const pinned = await createConversation(db, workspaceId, randomUUID());
    await db.query(`UPDATE conversations SET provider = 'claude', overrides = $2 WHERE id = $1`, [
      pinned.id,
      JSON.stringify({ claude: { model: 'haiku' } }),
    ]);
    const plain = await createConversation(db, workspaceId, randomUUID());
    await db.query(`UPDATE conversations SET provider = 'claude' WHERE id = $1`, [plain.id]);

    await runMigrations(db);

    const { rows } = await db.query<{ provider: string; model: string | null }>(
      'SELECT provider, model FROM provider_connections WHERE workspace_id = $1 ORDER BY provider',
      [workspaceId],
    );
    expect(rows).toEqual([
      { provider: 'claude', model: null },
      { provider: 'codex', model: null },
    ]);
    expect((await resolveChatSettings(db, pinned.id)).model).toBe('haiku');
    expect((await resolveChatSettings(db, plain.id)).model).toBeNull();
  });
});

describe('retiring models as defaults', () => {
  let t: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    t = await createTestDb();
    app = createTestApp(t, { fixedRunProvider: null });
    await saveConnection(t.db, t.workspaceId, 'claude', connection());
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const send = (method: 'patch' | 'get', url: string, body?: object) => {
    const call = request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN);
    return body ? call.send(body) : call;
  };

  it('refuses a retiring provider default but lets a chat pick it', async () => {
    const refused = await send('patch', '/api/providers/claude/defaults', { model: 'haiku' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/retires on 2026-10-15/);
    await send('patch', '/api/providers/claude/defaults', { model: 'sonnet' }).expect(200);

    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const picked = await send('patch', `/api/conversations/${id}/settings`, {
      provider: 'claude',
      model: 'haiku',
      routing: 'pinned',
    }).expect(200);
    expect(picked.body).toMatchObject({ model: 'haiku', routing: 'pinned' });
  });

  it('starts a new connection on Opus 5.5 in Auto, and keeps saved choices on reconnect', async () => {
    const fresh = await getSetupState(t.db, t.workspaceId);
    expect(fresh.providers.find((entry) => entry.id === 'claude')?.connection).toMatchObject({
      model: 'opus[1m]',
      agentMode: 'auto',
    });

    await t.db.query(
      `UPDATE provider_connections SET model = 'sonnet', agent_mode = 'default' WHERE workspace_id = $1`,
      [t.workspaceId],
    );
    await saveConnection(t.db, t.workspaceId, 'claude', connection());
    const kept = await getSetupState(t.db, t.workspaceId);
    expect(kept.providers.find((entry) => entry.id === 'claude')?.connection).toMatchObject({
      model: 'sonnet',
      agentMode: 'default',
    });
  });

  it('never reads a stored retiring default back, and drops it on reconnect', async () => {
    await t.db.query(`UPDATE provider_connections SET model = 'haiku' WHERE workspace_id = $1`, [
      t.workspaceId,
    ]);
    const setup = await getSetupState(t.db, t.workspaceId);
    expect(setup.providers.find((entry) => entry.id === 'claude')?.connection?.model).toBeNull();
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    expect((await resolveChatSettings(t.db, id)).model).toBeNull();

    await saveConnection(t.db, t.workspaceId, 'claude', connection());
    const { rows } = await t.db.query<{ model: string | null }>(
      'SELECT model FROM provider_connections WHERE workspace_id = $1',
      [t.workspaceId],
    );
    expect(rows[0]?.model).toBe('opus[1m]');
  });
});
