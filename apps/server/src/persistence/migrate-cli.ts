import { loadConfig } from '../config.ts';
import { createDb } from './db.ts';
import { migrateOrExit } from './migrate-startup.ts';
import { configuredBackup } from './startup-backup.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await migrateOrExit(db, { backup: configuredBackup(config) });
console.log('Database is up to date.');
await db.end();
process.exit(0);
