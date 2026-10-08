import { createDb } from '../../../apps/server/src/persistence/db.ts';
import { testDatabaseUrl } from '../../test-database.ts';

const db = createDb(testDatabaseUrl());
try {
  for (const schema of process.argv.slice(2)) {
    if (!/^e2e_live_\d+$/.test(schema)) throw new Error(`Refusing ${schema}`);
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  const { rows } = await db.query<{ schema_name: string }>(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'e2e_live_%'`,
  );
  console.log(
    'remaining e2e_live schemas:',
    rows.map((row) => row.schema_name),
  );
} finally {
  await db.end();
}
