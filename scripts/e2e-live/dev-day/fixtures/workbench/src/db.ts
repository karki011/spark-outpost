import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

export function openDb(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function migrationNames(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export function migrate(db: DatabaseSync, dir = MIGRATIONS_DIR): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  const done = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  const applied: string[] = [];
  for (const name of migrationNames(dir)) {
    if (done.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(dir, name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    applied.push(name);
  }
  return applied;
}
