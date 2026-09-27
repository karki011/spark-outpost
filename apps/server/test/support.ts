import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDb, POOL_MAX, type Db } from '../src/persistence/db.ts';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';

export interface TestDb {
  db: Db;
  workspaceId: string;
  cleanup(): Promise<void>;
}

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url)
    throw new Error('pnpm test:db requires DATABASE_URL or TEST_DATABASE_URL. Run pnpm db:setup.');
  return url;
}

async function admin<T>(url: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function createTestDb(): Promise<TestDb> {
  const url = testDatabaseUrl();
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin(url, (client) => client.query(`CREATE SCHEMA ${schema}`));
  const db = createDb(url, { searchPath: schema, max: POOL_MAX.test });
  await runMigrations(db);
  const workspaceId = await ensureLocalWorkspace(db);
  return {
    db,
    workspaceId,
    async cleanup() {
      await db.end();
      await admin(url, (client) => client.query(`DROP SCHEMA ${schema} CASCADE`));
    },
  };
}

export async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition not met within ${timeoutMs} ms.`);
}

export async function eventTypes(db: Db, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ type: string }>(
    'SELECT type FROM run_events WHERE run_id = $1 ORDER BY seq',
    [runId],
  );
  return rows.map((row) => row.type);
}

export async function activityTypesOf(db: Db, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ type: string }>(
    `SELECT payload->>'activityType' AS type FROM run_events
     WHERE run_id = $1 AND type = 'ACTIVITY_SNAPSHOT' ORDER BY seq`,
    [runId],
  );
  return rows.map((row) => row.type);
}
