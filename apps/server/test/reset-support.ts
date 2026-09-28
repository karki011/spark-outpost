import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedModelStats } from '../src/model-cards/ingest.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { insertOrchestration } from '../src/persistence/orchestrations.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import type { SecretId, SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import type { TestDb } from './support.ts';

export async function seedRun(t: TestDb): Promise<string> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Hello' },
    { provider: 'fake' },
  );
  await insertOrchestration(t.db, {
    runId: sent.run.id,
    depth: 'direct',
    depthSource: 'rules',
    risk: 'read-only',
    routing: 'auto',
    activeLimitMs: 60_000,
    toolCallLimit: 10,
    costCapUsd: null,
  });
  return sent.run.id;
}

export async function seedAppData(t: TestDb): Promise<{ mcpId: string }> {
  await seedRun(t);
  await seedModelStats(t.db);
  await updateProfile(t.db, t.workspaceId, { displayName: 'Hari' });
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, 'claude', 'api_key', '…4f2a', '[]', NULL, 'ask', 'high', now())`,
    [t.workspaceId],
  );
  await t.db.query(
    'INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)',
    [randomUUID(), t.workspaceId, 'app', '/tmp/spark-reset-project'],
  );
  const mcpId = randomUUID();
  await t.db.query(
    `INSERT INTO mcp_servers (id, workspace_id, source, name, transport, config, fingerprint)
     VALUES ($1, $2, 'user', 'docs', 'stdio', '{}', 'f')`,
    [mcpId, t.workspaceId],
  );
  return { mcpId };
}

export async function rowCounts(t: TestDb): Promise<Record<string, number>> {
  const { rows } = await t.db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name: table } of rows) {
    const result = await t.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "${table}"`,
    );
    counts[table] = result.rows[0]!.count;
  }
  return counts;
}

export function recordingStore(inner: SecretStore): SecretStore & { deleted: SecretId[] } {
  const deleted: SecretId[] = [];
  return {
    deleted,
    set: (id, secret) => inner.set(id, secret),
    get: (id) => inner.get(id),
    async delete(id) {
      deleted.push(id);
      await inner.delete(id);
    },
  };
}

export function postReset(t: TestDb, secrets: SecretStore, body: unknown) {
  return request(createTestApp(t, { secrets }))
    .post('/api/reset')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send(body as object);
}
