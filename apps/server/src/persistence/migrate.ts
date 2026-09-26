import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.ts';

export const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

const MIGRATION_LOCK_KEY = 7_331_001;

export async function runMigrations(db: Db, dir: string = migrationsDir): Promise<string[]> {
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
    const newlyApplied: string[] = [];
    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(path.join(dir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        newlyApplied.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return newlyApplied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    client.release();
  }
}

export async function pendingMigrations(db: Db, dir: string = migrationsDir): Promise<string[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const table = await db.query<{ exists: boolean }>(
    `SELECT to_regclass('schema_migrations') IS NOT NULL AS exists`,
  );
  if (!table.rows[0]?.exists) return files;
  const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));
  return files.filter((name) => !applied.has(name));
}

export async function assertMigrated(db: Db): Promise<void> {
  const pending = await pendingMigrations(db);
  if (pending.length > 0) {
    throw new Error(`Pending migrations: ${pending.join(', ')}. Run pnpm db:migrate.`);
  }
}
