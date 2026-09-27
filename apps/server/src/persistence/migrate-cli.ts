import { loadConfig } from '../config.ts';
import { backupDatabase } from './backup.ts';
import { createDb } from './db.ts';
import { migrateOrExit } from './migrate-startup.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await migrateOrExit(db, { backup: () => backupDatabase({ databaseUrl: config.DATABASE_URL }) });
console.log('Database is up to date.');
await db.end();
