import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildChatSummary } from '../src/compaction/summary.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let chatId: string;
let outpostId: string;
let minute = 0;

beforeEach(async () => {
  t = await createTestDb();
  chatId = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
  outpostId = randomUUID();
  minute = 0;
  await t.db.query(`INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, 'Launch')`, [
    outpostId,
    t.workspaceId,
  ]);
});

afterEach(async () => {
  await t.cleanup();
});

async function message(content: string, source: string): Promise<string> {
  const messageId = randomUUID();
  const runId = randomUUID();
  minute += 1;
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, 'user', $3, now() - interval '1 hour' + make_interval(mins => $4))`,
    [messageId, chatId, content, minute],
  );
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, source, created_at)
     VALUES ($1, $2, $3, 'fake', 'succeeded', $4,
       now() - interval '1 hour' + make_interval(mins => $5))`,
    [runId, chatId, messageId, source, minute],
  );
  return runId;
}

async function outpostRequest(content: string, fromUser: boolean): Promise<void> {
  await message(content, 'outpost');
  await t.db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user, from_handle, to_handle,
       to_conversation_id)
     SELECT m.id, $2, 'request', m.content, $3, CASE WHEN $3 THEN NULL ELSE 'api' END, 'docs', $4
     FROM messages m WHERE m.conversation_id = $4 AND m.content = $1`,
    [content, outpostId, fromUser, chatId],
  );
}

function decisionsOf(summary: string): string {
  const start = summary.indexOf('Your decisions and requests');
  const end = summary.indexOf('Recent turns, verbatim');
  return summary.slice(start, end);
}

describe("Spark's summary of a chat", () => {
  it("lists only the user's own requests under their decisions", async () => {
    await message('Use PostgreSQL for storage', 'ui');
    await outpostRequest('Push the release branch now', false);
    await outpostRequest('Rename the docs folder', true);
    await message('Ask Spark asked to delete the cache', 'assistant');
    await message('Workflow says to open a pull request', 'workflow');
    const runId = await message('Carry on', 'ui');

    const summary = await buildChatSummary(t.db, {
      identity: { runId, threadId: chatId },
      projectRoots: [],
      history: [],
    });

    const decisions = decisionsOf(summary);
    expect(decisions).toContain('Use PostgreSQL for storage');
    expect(decisions).toContain('Rename the docs folder');
    expect(decisions).not.toContain('Push the release branch now');
    expect(decisions).not.toContain('delete the cache');
    expect(decisions).not.toContain('open a pull request');
    expect(decisions).not.toContain('Carry on');
  });

  it('lists the latest 30 requests in order and counts the earlier ones', async () => {
    for (let index = 0; index < 33; index += 1) await message(`request ${index}`, 'ui');
    await message('Workflow says to open a pull request', 'workflow');
    await outpostRequest('Push the release branch now', false);
    const runId = await message('Carry on', 'ui');

    const summary = await buildChatSummary(t.db, {
      identity: { runId, threadId: chatId },
      projectRoots: [],
      history: [],
    });

    const decisions = decisionsOf(summary);
    expect(decisions).toContain('(3 earlier requests not listed)');
    expect(decisions).not.toMatch(/: request 2\n/);
    expect(decisions).toMatch(/4\. \d{4}-\d{2}-\d{2}: request 3\n/);
    expect(decisions).toMatch(/33\. \d{4}-\d{2}-\d{2}: request 32\n/);
    expect(decisions.indexOf('request 3\n')).toBeLessThan(decisions.indexOf('request 32'));
    expect(decisions).not.toContain('open a pull request');
    expect(decisions).not.toContain('Push the release branch now');
  });
});
