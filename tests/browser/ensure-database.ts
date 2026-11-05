import { createDb } from '../../apps/server/src/persistence/db.ts';
import { TEST_DATABASE_URL } from './stub-config.ts';

const shared = process.env.TEST_DATABASE_URL;
const target = TEST_DATABASE_URL;

if (shared && target && shared !== target) {
  const name = new URL(target).pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unexpected test database name: ${name}`);
  const db = createDb(shared, { connectTries: 7 });
  try {
    const { rowCount } = await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await db.query(`CREATE DATABASE ${name}`);
  } finally {
    await db.end();
  }
}
