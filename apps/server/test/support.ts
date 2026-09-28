import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { ProviderId } from '@spark-outpost/contracts';
import { createDb, POOL_MAX, type Db } from '../src/persistence/db.ts';
import { ensureLocalWorkspace, sendUserMessage } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import type { RunInput } from '../src/workflow/run-input.ts';

export interface TestDb {
  db: Db;
  workspaceId: string;
  cleanup(): Promise<void>;
}

export function testDatabaseUrl(): string {
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

export async function createTestSchema(): Promise<string> {
  const url = testDatabaseUrl();
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin(url, (client) => client.query(`CREATE SCHEMA ${schema}`));
  return schema;
}

export async function dropTestSchema(schema: string): Promise<void> {
  await admin(testDatabaseUrl(), (client) => client.query(`DROP SCHEMA ${schema} CASCADE`));
}

export function schemaDb(schema: string): Db {
  return createDb(testDatabaseUrl(), { searchPath: schema, max: POOL_MAX.test });
}

export async function createTestDb(): Promise<TestDb> {
  const schema = await createTestSchema();
  const db = schemaDb(schema);
  await runMigrations(db);
  const workspaceId = await ensureLocalWorkspace(db);
  return {
    db,
    workspaceId,
    async cleanup() {
      await db.end();
      await dropTestSchema(schema);
    },
  };
}

export async function connectCliProvider(t: TestDb, provider: ProviderId): Promise<void> {
  await saveConnection(t.db, t.workspaceId, provider, {
    method: 'cli',
    detail: `${provider} 1.0`,
    summary: '',
    models: [],
  });
}

export async function startChat(
  t: TestDb,
  content: string,
): Promise<{ conversationId: string; runId: string }> {
  const conversationId = randomUUID();
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake' },
    t.workspaceId,
  );
  return { conversationId, runId: sent.run.id };
}

export const SESSION_LIMITS = { idleMs: 30 * 60_000, openLimit: 8 };

export function chatTurnInput(
  t: TestDb,
  conversationId: string,
  previousMessageId: string | null,
): RunInput {
  return {
    identity: { runId: randomUUID(), threadId: conversationId },
    workspaceId: t.workspaceId,
    prompt: 'next',
    attachments: [],
    provider: 'claude',
    history: [],
    settings: { method: 'cli', model: 'sonnet', modelLabel: 'Sonnet', effort: 'medium' },
    projectRoots: [],
    mode: 'chat',
    level: 'balanced',
    agentMode: null,
    parentRunId: null,
    userRequest: 'next',
    role: null,
    copyOf: null,
    askTitle: false,
    previousMessageId,
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
