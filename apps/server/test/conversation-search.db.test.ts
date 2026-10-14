import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { listConversations, sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function chat(title: string, content: string) {
  const id = randomUUID();
  const messageId = randomUUID();
  const sent = await sendUserMessage(
    t.db,
    id,
    { id: messageId, content },
    { provider: 'fake' },
    t.workspaceId,
  );
  await t.db.query('UPDATE conversations SET title = $2 WHERE id = $1', [id, title]);
  return { id, messageId, runId: sent.run.id };
}

async function reply(conversationId: string, runId: string, content: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     VALUES ($1, $2, 'assistant', $3, $4)`,
    [id, conversationId, content, runId],
  );
  return id;
}

const ids = (chats: ConversationSummary[]) => chats.map((item) => item.id);
const marked = (item: ConversationSummary | undefined) =>
  item?.match?.parts.filter((part) => part.match).map((part) => part.text);

describe('searching chats', () => {
  it('still finds any part of a title', async () => {
    const flaky = await chat('Fix the flaky login test', 'hello');
    await chat('Other', 'nothing here');

    const found = await listConversations(t.db, t.workspaceId, 'laky log');

    expect(ids(found)).toEqual([flaky.id]);
    expect(found[0]!.match).toBeUndefined();
  });

  it('matches words by their start, in any order, inside paths and identifiers', async () => {
    const auth = await chat('Auth', 'We refactored the authentication middleware today.');
    const path = await chat('Path', 'The bug is in apps/server/src/foo_bar.ts somewhere.');

    expect(ids(await listConversations(t.db, t.workspaceId, 'middle authent'))).toEqual([auth.id]);
    expect(ids(await listConversations(t.db, t.workspaceId, 'server'))).toEqual([path.id]);
    expect(ids(await listConversations(t.db, t.workspaceId, 'foo_bar'))).toEqual([path.id]);
    expect(await listConversations(t.db, t.workspaceId, 'thentication')).toEqual([]);
  });

  it('returns the best matching message with a marked snippet and its turn', async () => {
    const found = await chat('Deploy notes', 'How do we ship this?');
    const best = await reply(
      found.id,
      found.runId,
      'Run the release pipeline, then the release pipeline checks the release tag.',
    );
    await reply(found.id, found.runId, 'One more release later.');

    const [hit] = await listConversations(t.db, t.workspaceId, 'release pipe');

    expect(hit?.match).toMatchObject({ messageId: best, runId: found.runId });
    expect(marked(hit)).toEqual(['release', 'pipeline', 'release', 'pipeline', 'release']);
    expect(hit?.match?.parts.map((part) => part.text).join('')).toBe(
      'Run the release pipeline, then the release pipeline checks the release tag.',
    );
  });

  it('gives a user message the run it started', async () => {
    const found = await chat('Question', 'Please rename the widget factory');

    const [hit] = await listConversations(t.db, t.workspaceId, 'widget');

    expect(hit?.match).toMatchObject({ messageId: found.messageId, runId: found.runId });
  });

  it('ranks a title match first, then the closer message match', async () => {
    const once = await chat('One', 'cache');
    await reply(
      once.id,
      once.runId,
      `A long story about many things ${'filler '.repeat(80)} cache.`,
    );
    const often = await chat('Two', 'cache cache cache invalidation');
    const titled = await chat('Cache warming', 'unrelated words');
    await t.db.query(
      `UPDATE conversations SET updated_at = now() + interval '1 hour' WHERE id = $1`,
      [once.id],
    );

    expect(ids(await listConversations(t.db, t.workspaceId, 'cache'))).toEqual([
      titled.id,
      often.id,
      once.id,
    ]);
  });

  it('falls back to plain text for a query without words', async () => {
    const arrow = await chat('Arrow', 'map a -> b then stop');
    await chat('Other', 'map a to b');

    const found = await listConversations(t.db, t.workspaceId, '->');

    expect(ids(found)).toEqual([arrow.id]);
    expect(marked(found[0])).toEqual(['->']);
  });

  it('treats search operators as text', async () => {
    await chat('Ops', 'plain words');

    await expect(listConversations(t.db, t.workspaceId, "a & | ! :* ' <-> (")).resolves.toEqual([]);
  });

  it('keeps markup as plain snippet text', async () => {
    await chat('Markup', 'Here is <script>alert("hi")</script> and **bold** text');

    const [hit] = await listConversations(t.db, t.workspaceId, 'alert');

    expect(hit?.match?.parts).toEqual([
      { text: 'Here is <script>', match: false },
      { text: 'alert', match: true },
      { text: '("hi")</script> and **bold** text', match: false },
    ]);
  });

  it('saves and finds a very long message', async () => {
    const words = Array.from({ length: 70000 }, (_, index) => `w${index}x${index * 7919}`);
    const huge = await chat('Huge', `needle ${words.join(' ')}`);

    const found = await listConversations(t.db, t.workspaceId, 'needle');

    expect(ids(found)).toEqual([huge.id]);
    expect(found[0]?.match?.parts.at(-1)).toEqual({ text: '…', match: false });
  });

  it('uses the message index', async () => {
    const client = await t.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM messages WHERE search @@ to_tsquery('simple', 'needle:*')`,
      );
      expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain('messages_search_idx');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
