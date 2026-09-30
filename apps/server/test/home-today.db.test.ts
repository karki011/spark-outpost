import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { todaySummarySchema } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { seedAccept } from './outcome-seed.ts';
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

async function today(tz = 'UTC') {
  const response = await request(app)
    .get(`/api/home/today?tz=${encodeURIComponent(tz)}`)
    .set(LOCAL_HEADERS);
  expect(response.status).toBe(200);
  return todaySummarySchema.parse(response.body);
}

async function chat(title: string, hoursAgo = 0, cost: number | null = null) {
  const conversationId = randomUUID();
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: title },
    { provider: 'claude', model: null },
    t.workspaceId,
  );
  const at = new Date(Date.now() - hoursAgo * 3_600_000);
  await t.db.query(
    `UPDATE runs SET status = 'succeeded', cost_usd = $2, cost_source = $3, created_at = $4,
       finished_at = $4 WHERE id = $1`,
    [sent.run.id, cost, cost === null ? null : 'reported', at],
  );
  await t.db.query(`UPDATE conversations SET title = $2, updated_at = $3 WHERE id = $1`, [
    conversationId,
    title,
    at,
  ]);
  const taskId = randomUUID();
  await t.db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
    taskId,
    conversationId,
    title,
  ]);
  return { conversationId, runId: sent.run.id, taskId };
}

async function openPr(taskId: string) {
  await t.db.query(
    `INSERT INTO task_ships (task_id, root_path, branch, pr_url, pr_number)
     VALUES ($1, '/tmp/repo', 'spark/pr', 'https://github.com/o/r/pull/7', 7)`,
    [taskId],
  );
}

async function linkTicket(taskId: string, key: string) {
  await t.db.query(
    `INSERT INTO tickets (workspace_id, source, key, title, status, status_name, url, updated_at)
     VALUES ($1, 'linear', $2, 'Ticket', 'in_progress', 'In Progress', 'https://linear.app/x', now())
     ON CONFLICT DO NOTHING`,
    [t.workspaceId, key],
  );
  await t.db.query(
    `INSERT INTO task_tickets (task_id, workspace_id, source, ticket_key)
     VALUES ($1, $2, 'linear', $3)`,
    [taskId, t.workspaceId, key],
  );
  await t.db.query(
    `INSERT INTO ticket_events (id, workspace_id, source, action, ticket_key, task_id, outcome)
     VALUES ($1, $2, 'linear', 'transition', $3, $4, 'succeeded')`,
    [randomUUID(), t.workspaceId, key, taskId],
  );
}

describe('GET /api/home/today', () => {
  it('sums the chats, kept changes, PRs, tickets and spend from today', async () => {
    const auth = await chat('Fix the login bug', 0.01, 0.4);
    await seedAccept(t.db, auth.runId, 'keep');
    await openPr(auth.taskId);
    await linkTicket(auth.taskId, 'ENG-1');
    const docs = await chat('Update the docs', 0.005, 0.1);
    await seedAccept(t.db, docs.runId, 'revert');
    await chat('Last month', 24 * 40, 5);

    const summary = await today();
    expect(summary).toMatchObject({
      chats: 2,
      kept: 1,
      prs: 1,
      tickets: 1,
      waiting: 0,
      costSource: 'reported',
    });
    expect(summary.costUsd).toBeCloseTo(0.5);
    expect(summary.recent.map((entry) => entry.title)).toEqual([
      'Update the docs',
      'Fix the login bug',
    ]);
    expect(summary.recent[1]).toMatchObject({
      id: auth.conversationId,
      kept: 1,
      prs: 1,
      tickets: 1,
      state: 'finished',
    });
  });

  it('is empty on a quiet day and rejects an unknown time zone', async () => {
    await chat('Yesterday-ish', 24 * 3, 1);
    expect(await today()).toMatchObject({ chats: 0, kept: 0, recent: [], costUsd: null });

    const bad = await request(app).get('/api/home/today?tz=Not/A_Zone').set(LOCAL_HEADERS);
    expect(bad.status).toBe(400);
  });
});
