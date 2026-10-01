import { readdir } from 'node:fs/promises';
import pg from 'pg';
import type { PendingMigrations } from './update-migration.ts';

export async function pendingMigrations(
  databaseUrl: string,
  migrationsDir: string,
): Promise<PendingMigrations> {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows: exists } = await client.query<{ present: boolean }>(
      `SELECT to_regclass('schema_migrations') IS NOT NULL AS present`,
    );
    if (!exists[0]?.present) return { pending: files, fresh: true };
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    return { pending: files.filter((name) => !applied.has(name)), fresh: applied.size === 0 };
  } finally {
    await client.end();
  }
}
