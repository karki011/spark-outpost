import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  providerIdSchema,
  workPlaceSchema,
  type InvolvementLevel,
  type ProviderId,
  type WorkPlace,
} from '@spark-outpost/contracts';
import { createDb, POOL_MAX, type Db } from '../src/persistence/db.ts';
import { ensureLocalWorkspace, sendUserMessage } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import type { RunInput } from '../src/workflow/run-input.ts';
import { truncateTables } from '../src/persistence/truncate.ts';

export interface TestDb {
  db: Db;
  workspaceId: string;
  cleanup(): Promise<void>;
}

function suiteDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url)
    throw new Error('pnpm test:db requires DATABASE_URL or TEST_DATABASE_URL. Run pnpm db:setup.');
  return url;
}

export function testDatabaseUrl(): string {
  const url = new URL(suiteDatabaseUrl());
  const worker = process.env.VITEST_POOL_ID;
  if (worker) url.pathname = `${url.pathname}_w${worker}`;
  return url.toString();
}

const ALREADY_EXISTS = new Set(['42P04', '23505']);

export async function ensureWorkerDatabase(): Promise<void> {
  const url = testDatabaseUrl();
  const name = new URL(url).pathname.slice(1);
  await admin(suiteDatabaseUrl(), async (server) => {
    const { rowCount } = await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount) return;
    await server.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`).catch((error: unknown) => {
      if (!ALREADY_EXISTS.has((error as { code?: string }).code ?? '')) throw error;
    });
  });
}

const CONNECT_TRIES = 7;

async function admin<T>(url: string, work: (server: Db) => Promise<T>): Promise<T> {
  const server = createDb(url, { max: 1, connectTries: CONNECT_TRIES });
  try {
    return await work(server);
  } finally {
    await server.end();
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
  return createDb(testDatabaseUrl(), {
    searchPath: schema,
    max: POOL_MAX.test,
    connectTries: CONNECT_TRIES,
  });
}

const spareSchemas: string[] = [];

async function emptyTables(db: Db, schema: string): Promise<void> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables
     WHERE schemaname = $1 AND tablename <> 'schema_migrations'`,
    [schema],
  );
  await truncateTables(
    db,
    rows.map((row) => row.name),
  );
}

async function openSchema(url: string): Promise<{ schema: string; db: Db }> {
  const spare = spareSchemas.pop();
  const schema = spare ?? `test_${randomUUID().replaceAll('-', '')}`;
  if (!spare) await admin(url, (server) => server.query(`CREATE SCHEMA ${schema}`));
  const db = createDb(url, { searchPath: schema, max: POOL_MAX.test, connectTries: CONNECT_TRIES });
  if (spare) await emptyTables(db, schema);
  else await runMigrations(db);
  return { schema, db };
}

export async function createTestDb(options: { workPlace?: WorkPlace } = {}): Promise<TestDb> {
  const url = testDatabaseUrl();
  const { schema, db } = await openSchema(url);
  const place = workPlaceSchema.parse(options.workPlace ?? 'checkout');
  await db.query(`ALTER TABLE projects ALTER COLUMN work_place SET DEFAULT '${place}'`);
  const workspaceId = await ensureLocalWorkspace(db);
  let closed = false;
  return {
    db,
    workspaceId,
    async cleanup() {
      if (closed) return;
      closed = true;
      await db.end();
      spareSchemas.push(schema);
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
    level: 'hands-off',
    agentMode: null,
    parentRunId: null,
    userRequest: 'next',
    role: null,
    copyOf: null,
    askTitle: false,
    previousMessageId,
  };
}

export async function dropSpareSchemas(): Promise<void> {
  const schemas = spareSchemas.splice(0);
  if (schemas.length === 0) return;
  await admin(testDatabaseUrl(), (server) =>
    server.query(`DROP SCHEMA ${schemas.join(', ')} CASCADE`),
  );
}

export async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
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

export async function pinChatLevel(
  db: Db,
  conversationId: string,
  level: InvolvementLevel,
): Promise<void> {
  const pinned = Object.fromEntries(providerIdSchema.options.map((id) => [id, { level }]));
  await db.query(`UPDATE conversations SET overrides = $2::jsonb || overrides WHERE id = $1`, [
    conversationId,
    JSON.stringify(pinned),
  ]);
}

export const BUILDER_SESSION_KEYS = 'chat:%';
