import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsDir } from '../src/persistence/migrate.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function orchestration(conversationId: string, minute: number) {
  const messageId = randomUUID();
  const runId = randomUUID();
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', 'go')`,
    [messageId, conversationId],
  );
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, created_at)
     VALUES ($1, $2, $3, 'claude', 'succeeded', $4)`,
    [runId, conversationId, messageId, `2026-09-01T10:${minute}:00Z`],
  );
  return { runId, messageId };
}

async function child(
  parent: { runId: string; messageId: string },
  conversationId: string,
  role: string,
  name: string,
  second: number,
  label: string | null = `${name} · Haiku 4.5 · low`,
) {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
       role, agent_label, route, created_at)
     VALUES ($1, $2, $3, 'claude', 'succeeded', $4, $5, $6, $7,
       (SELECT created_at FROM runs WHERE id = $4) + make_interval(secs => $8))`,
    [id, conversationId, parent.messageId, parent.runId, role, label, { name }, second],
  );
  return id;
}

async function names(ids: readonly string[]) {
  const { rows } = await t.db.query<{ id: string; name: string; agent_label: string | null }>(
    `SELECT id, route->>'name' AS name, agent_label FROM runs WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return ids.map((id) => {
    const row = rows.find((candidate) => candidate.id === id)!;
    return [row.name, row.agent_label];
  });
}

describe('crew name backfill', () => {
  it('gives old numbered crew friendly names in order, keeping retries and new names', async () => {
    const conversationId = randomUUID();
    await t.db.query(`INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, 'x')`, [
      conversationId,
      t.workspaceId,
    ]);
    const first = await orchestration(conversationId, 10);
    const ids = [
      await child(first, conversationId, 'architect', 'Architect', 1),
      await child(first, conversationId, 'builder', 'Builder', 2),
      await child(first, conversationId, 'builder', 'Builder 2', 3),
      await child(first, conversationId, 'builder', 'Builder', 4),
      await child(first, conversationId, 'builder', 'Bolt', 5, 'Bolt · Builder · Sonnet 5'),
      await child(first, conversationId, 'critic', 'Critic', 6, 'Critic'),
      await child(first, conversationId, 'scout', 'Scout', 7, null),
    ];
    const sql = await readFile(path.join(migrationsDir, '0023_crew_names.sql'), 'utf8');
    await t.db.query(sql);
    expect(await names(ids)).toEqual([
      ['Sketch', 'Sketch · Architect · Haiku 4.5 · low'],
      ['Rivet', 'Rivet · Builder · Haiku 4.5 · low'],
      ['Tack', 'Tack · Builder · Haiku 4.5 · low'],
      ['Rivet', 'Rivet · Builder · Haiku 4.5 · low'],
      ['Bolt', 'Bolt · Builder · Sonnet 5'],
      ['Hawk', 'Hawk · Critic'],
      ['Pip', null],
    ]);
    await t.db.query(sql);
    expect((await names(ids))[1]).toEqual(['Rivet', 'Rivet · Builder · Haiku 4.5 · low']);
  });
});
