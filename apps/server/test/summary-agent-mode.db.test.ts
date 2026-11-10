import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

async function seedRun(agentMode: string | null, usedMode: string | null): Promise<string> {
  const conversationId = randomUUID();
  await t.db.query(`INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, 'Chat')`, [
    conversationId,
    t.workspaceId,
  ]);
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', 'hi')`,
    [randomUUID(), conversationId],
  );
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, agent_mode, used_mode)
     VALUES ($1, $2, NULL, 'claude', 'running', $3, $4)`,
    [randomUUID(), conversationId, agentMode, usedMode],
  );
  return conversationId;
}

const summaries = async () =>
  (await request(app).get('/api/conversations').set(LOCAL_HEADERS).expect(200)).body as {
    id: string;
    latestRun: { agentMode: string | null } | null;
  }[];

it('carries the latest turn mode on the summary, preferring the mode it ran with', async () => {
  const chosen = await seedRun('default', 'auto');
  const stored = await seedRun('plan', null);
  const unset = await seedRun(null, null);
  const byId = new Map((await summaries()).map((chat) => [chat.id, chat.latestRun?.agentMode]));
  expect(byId.get(chosen)).toBe('auto');
  expect(byId.get(stored)).toBe('plan');
  expect(byId.get(unset)).toBeNull();
});
