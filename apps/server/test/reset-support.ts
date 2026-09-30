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

async function seedMap(t: TestDb): Promise<void> {
  const repos = [randomUUID(), randomUUID()].sort();
  for (const [index, id] of repos.entries()) {
    await t.db.query(
      `INSERT INTO map_repos (id, root_path, rules_version, status) VALUES ($1, $2, 'r', 'ready')`,
      [id, `/tmp/spark-reset-map-${index}`],
    );
    await t.db.query(
      `INSERT INTO map_areas (repo_id, id, root, source, package, reason, file_count, line_count,
         fan_in, fan_out, importance, rule_category, rule_kind, x, y, radius)
       VALUES ($1, 'a1', 'src', 'folder', '.', 'folder src', 1, 1, 0, 0, 0, 'core', 'domain', 0, 0, 1)`,
      [id],
    );
    await t.db.query(
      `INSERT INTO map_files (repo_id, path, area_id, language, lines, fan_in, fan_out, importance, x, y)
       VALUES ($1, 'src/a.ts', 'a1', 'typescript', 1, 0, 0, 0, 0, 0)`,
      [id],
    );
  }
  await t.db.query(
    `INSERT INTO map_labels (repo_id, area_id, source, category, kind, name, description, policy_version)
     VALUES ($1, 'a1', 'rules', 'core', 'domain', 'Src', 'd', 'p')`,
    [repos[0]],
  );
  await t.db.query(
    `INSERT INTO map_overrides (root_path, area_id, category) VALUES ('/tmp/spark-reset-map-0', 'a1', 'shared')`,
  );
  await t.db.query(
    `INSERT INTO map_jev_calls (repo_id, purpose, subject, jev_status, policy_version)
     VALUES ($1, 'area_label', 'a1', 'failed', 'p')`,
    [repos[0]],
  );
  await t.db.query('INSERT INTO map_link_pairs (repo_a, repo_b, signature) VALUES ($1, $2, $3)', [
    repos[0],
    repos[1],
    's',
  ]);
  await t.db.query(
    `INSERT INTO map_links (repo_a, repo_b, from_repo, to_repo, kind, label, from_path, to_path,
       from_area, to_area, confidence, source)
     VALUES ($1, $2, $1, $2, 'http', 'GET /a', 'src/a.ts', 'src/a.ts', 'a1', 'a1', 0.9, 'rules')`,
    [repos[0], repos[1]],
  );
}

export async function seedAppData(t: TestDb): Promise<{ mcpId: string }> {
  await seedRun(t);
  await seedMap(t);
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
