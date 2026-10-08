import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from '../../../apps/server/src/persistence/db.ts';

const dir = process.env.FINAL_DIR ?? '';
const state = JSON.parse(readFileSync(join(dir, 'stack.json'), 'utf8')) as { databaseUrl: string };
const db = createDb(state.databaseUrl);
try {
  const { rows } = await db.query(process.argv[2] ?? 'select 1');
  for (const row of rows) console.log(JSON.stringify(row));
} finally {
  await db.end();
}
