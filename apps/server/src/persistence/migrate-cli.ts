import { loadConfig } from '../config.ts';
import { createDb } from './db.ts';
import { runMigrations } from './migrate.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
try {
  const applied = await runMigrations(db);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await db.end();
}
