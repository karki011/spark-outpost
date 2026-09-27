import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.ts';

export const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

const MIGRATION_LOCK_KEY = 7_331_001;

export class MigrationError extends Error {
  readonly migration: string;

  constructor(migration: string, cause: unknown) {
    super(`Migration ${migration} failed: ${(cause as Error).message}`, { cause });
    this.migration = migration;
  }
}

export interface MigrationOptions {
  dir?: string;
  beforeUpgrade?: (pending: string[]) => Promise<void>;
}

export async function runMigrations(db: Db, options: MigrationOptions = {}): Promise<string[]> {
  const { dir = migrationsDir, beforeUpgrade } = options;
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const pending = files.filter((name) => !applied.has(name));
    if (pending.length > 0 && applied.size > 0) await beforeUpgrade?.(pending);
    for (const name of pending) {
      const sql = await readFile(path.join(dir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError(name, error);
      }
    }
    return pending;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    client.release();
  }
}
