import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertCompaction } from '../src/persistence/compactions.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let tools: SparkToolsHarness | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await tools?.close();
  tools = null;
  await t.cleanup();
});

async function message(conversationId: string, role: 'user' | 'assistant', content: string) {
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())`,
    [randomUUID(), conversationId, role, content],
  );
}

interface History {
  totalTurns: number;
  matched: number;
  nextFrom?: number;
  turns: { turn: number; role: string; text: string }[];
  compactions: { method: string; tokensBefore: number | null; summary?: string }[];
}

describe('spark_chat_history', () => {
  it('returns old turns by range and by search, with compaction summaries', async () => {
    const chat = await startChat(t, 'Remember PELICAN');
    for (let index = 1; index <= 6; index++) {
      await message(chat.conversationId, 'assistant', `Reply ${index}`);
      await message(chat.conversationId, 'user', `Question ${index}`);
    }
    await insertCompaction(t.db, {
      conversationId: chat.conversationId,
      runId: chat.runId,
      sessionRowId: null,
      agentKey: 'chat:chat',
      method: 'spark',
      tokensBefore: 172_000,
      tokensAfter: 21_000,
      contextSize: 200_000,
      summary: '# Compacted chat summary\nThe word was PELICAN.',
      lastMessageId: null,
    });
    tools = await startSparkTools(t, { conversationId: chat.conversationId });

    const range = (await tools.call('spark_chat_history', { from: 0, to: 2 })).json<History>();
    const found = (await tools.call('spark_chat_history', { query: 'pelican' })).json<History>();
    const paged = (
      await tools.call('spark_chat_history', { limit: 2, summaries: false })
    ).json<History>();

    expect(range.totalTurns).toBe(13);
    expect(range.turns.map((turn) => [turn.turn, turn.role, turn.text])).toEqual([
      [0, 'user', 'Remember PELICAN'],
      [1, 'assistant', 'Reply 1'],
      [2, 'user', 'Question 1'],
    ]);
    expect(range.compactions).toEqual([
      expect.objectContaining({
        method: 'spark',
        tokensBefore: 172_000,
        summary: '# Compacted chat summary\nThe word was PELICAN.',
      }),
    ]);
    expect(found.turns.map((turn) => turn.text)).toEqual(['Remember PELICAN']);
    expect(paged).toMatchObject({ matched: 13, nextFrom: 2, compactions: [] });
  });

  it('refuses a chat from another workspace', async () => {
    tools = await startSparkTools(t, { conversationId: null });
    const missing = await tools.call('spark_chat_history', { chat: randomUUID() });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe('That chat does not exist. It may have been deleted.');
  });
});
