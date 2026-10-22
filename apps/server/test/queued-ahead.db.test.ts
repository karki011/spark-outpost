import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  listConversations,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function queuedChat(): Promise<{ conversationId: string; runId: string }> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Hi' },
    { provider: 'claude' },
  );
  return { conversationId: conversation.id, runId: sent.run.id };
}

async function aheadOf(conversationId: string): Promise<number | undefined> {
  const chats = await listConversations(t.db, t.workspaceId);
  return chats.find((chat) => chat.id === conversationId)?.latestRun?.ahead;
}

describe('how many turns are ahead of a queued one', () => {
  it('counts queued jobs before it, but not a digest, which the chat list never refreshes for', async () => {
    const digest = await queuedChat();
    const first = await queuedChat();
    const last = await queuedChat();
    await t.db.query(`UPDATE runs SET role = 'digest' WHERE id = $1`, [digest.runId]);

    expect(await aheadOf(first.conversationId)).toBe(0);
    expect(await aheadOf(last.conversationId)).toBe(1);

    await t.db.query(`UPDATE jobs SET status = 'leased' WHERE run_id = $1`, [first.runId]);
    expect(await aheadOf(last.conversationId)).toBe(0);
  });
});
