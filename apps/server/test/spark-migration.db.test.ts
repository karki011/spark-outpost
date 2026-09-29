import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/persistence/db.ts';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { migrationsDir, runMigrations } from '../src/persistence/migrate.ts';
import { getSetupState } from '../src/persistence/setup.ts';
import { createTestSchema, dropTestSchema, schemaDb } from './support.ts';

const SPARK_MIGRATION = '0057_spark_settings.sql';

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

it('gives existing profiles Friendly, Spark on, team mode and call me by name', async () => {
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
    teamMode: true,
    useName: true,
  });
  await expect(
    db.query(`UPDATE profiles SET personality = 'grumpy' WHERE workspace_id = $1`, [workspaceId]),
  ).rejects.toThrow();
});
