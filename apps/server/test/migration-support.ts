import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { Db } from '../src/persistence/db.ts';
import { migrationsDir, runMigrations } from '../src/persistence/migrate.ts';
import { createTestSchema, dropTestSchema, schemaDb } from './support.ts';

export function migratedUpTo(migration: string) {
  const state = { schema: '', db: null as unknown as Db, before: '' };
  beforeEach(async () => {
    state.schema = await createTestSchema();
    state.db = schemaDb(state.schema);
    state.before = await mkdtemp(path.join(tmpdir(), 'spark-migrations-'));
    for (const name of await readdir(migrationsDir)) {
      if (name.endsWith('.sql') && name < migration) {
        await cp(path.join(migrationsDir, name), path.join(state.before, name));
      }
    }
    await runMigrations(state.db, { dir: state.before });
  });

  afterEach(async () => {
    await state.db.end();
    await dropTestSchema(state.schema);
    await rm(state.before, { recursive: true, force: true });
  });
  return state;
}

export async function oldConnection(
  db: Db,
  workspaceId: string,
  provider: string,
  permission: string,
  level: string,
): Promise<void> {
  await db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, level, effort, verified_at)
     VALUES ($1, $2, 'cli', 'x', '[]', NULL, $3, $4, 'medium', now())`,
    [workspaceId, provider, permission, level],
  );
}
