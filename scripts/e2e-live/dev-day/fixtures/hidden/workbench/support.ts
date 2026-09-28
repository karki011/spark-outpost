import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS_DIR, migrate, openDb } from '../src/db.ts';

export const ORIGINAL_MIGRATIONS: Record<string, string> = {
  '001_projects.sql': `CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  budget INTEGER NOT NULL DEFAULT 0
);
`,
  '002_expenses.sql': `CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`,
};

/** A database as it was before today: only the original two migrations, applied. */
export function legacyDb(): DatabaseSync {
  const db = openDb();
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY)');
  for (const [name, sql] of Object.entries(ORIGINAL_MIGRATIONS)) {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  return db;
}

export function freshDb(): DatabaseSync {
  const db = openDb();
  migrate(db);
  return db;
}

export function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (row) => row.name,
  );
}

export function migrationText(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}
