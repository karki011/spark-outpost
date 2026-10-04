import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/persistence/db.ts';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { migrationsDir, runMigrations } from '../src/persistence/migrate.ts';
import { getSetupState } from '../src/persistence/setup.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  createTestDb,
  createTestSchema,
  dropTestSchema,
  schemaDb,
  type TestDb,
} from './support.ts';

const SPARK_MIGRATION = '0057_spark_settings.sql';

describe('the Spark migration', () => {
  let schema: string;
  let db: Db;
  let before: string;

  beforeEach(async () => {
    schema = await createTestSchema();
    db = schemaDb(schema);
    before = await mkdtemp(path.join(tmpdir(), 'spark-migrations-'));
    for (const name of await readdir(migrationsDir)) {
      if (name.endsWith('.sql') && name < SPARK_MIGRATION) {
        await cp(path.join(migrationsDir, name), path.join(before, name));
      }
    }
    await runMigrations(db, { dir: before });
  });

  afterEach(async () => {
    await db.end();
    await dropTestSchema(schema);
    await rm(before, { recursive: true, force: true });
  });

  it('gives existing profiles Friendly and Spark on', async () => {
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(`INSERT INTO profiles (workspace_id, display_name) VALUES ($1, 'Hazel')`, [
      workspaceId,
    ]);

    await runMigrations(db);

    const { profile } = await getSetupState(db, workspaceId);
    expect(profile).toMatchObject({
      displayName: 'Hazel',
      personality: 'friendly',
      sparkEnabled: true,
    });
    await expect(
      db.query(`UPDATE profiles SET personality = 'grumpy' WHERE workspace_id = $1`, [workspaceId]),
    ).rejects.toThrow();
  });
});

describe('Spark preferences', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('saves them through the profile API and rejects an unknown personality', async () => {
    const { get, send } = localClient(createTestApp(t));
    const { body } = await send('patch', '/api/profile', {
      personality: 'playful',
      sparkEnabled: false,
    }).expect(200);
    expect(body.profile).toMatchObject({
      personality: 'playful',
      sparkEnabled: false,
    });
    await send('patch', '/api/profile', { personality: 'grumpy' }).expect(400);
    const { body: after } = await get('/api/setup').expect(200);
    expect(after.profile.personality).toBe('playful');
  });

  it('remembers the wide-window layout and refuses an unknown one', async () => {
    const { send } = localClient(createTestApp(t));
    const { body } = await send('patch', '/api/profile', { wideWindow: 'panel' }).expect(200);
    expect(body.profile.wideWindow).toBe('panel');
    const kept = await send('patch', '/api/profile', { displayName: 'Hazel' }).expect(200);
    expect(kept.body.profile.wideWindow).toBe('panel');
    await send('patch', '/api/profile', { wideWindow: 'sideways' }).expect(400);
  });
});
