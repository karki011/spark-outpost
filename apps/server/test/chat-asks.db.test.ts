import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationDetail } from '@spark-outpost/contracts';
import {
  getChatAsk,
  insertChatAsk,
  listChatAsks,
  markChatAskDelivered,
  settleChatAsk,
  type NewChatAsk,
} from '../src/persistence/chat-asks.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let sender: string;
let senderRun: string;
let receiver: string;
let receiverRun: string;

beforeEach(async () => {
  t = await createTestDb();
  ({ conversationId: sender, runId: senderRun } = await startChat(t, 'Checkout rewrite'));
  ({ conversationId: receiver, runId: receiverRun } = await startChat(t, 'Orders API'));
});

afterEach(async () => {
  await t.cleanup();
});

function ask(change: Partial<NewChatAsk> = {}): NewChatAsk {
  return {
    id: randomUUID(),
    workspaceId: t.workspaceId,
    kind: 'message',
    fromConversationId: sender,
    fromRunId: senderRun,
    fromTitle: 'Checkout rewrite',
    toConversationId: receiver,
    body: 'What does the endpoint return?',
    replyTo: null,
    wantsReply: true,
    ...change,
  };
}

describe('storing an ask', () => {
  it('starts Waiting and undelivered, naming both chats', async () => {
    const sent = ask();

    expect(await insertChatAsk(t.db, sent)).toBe(true);

    expect(await getChatAsk(t.db, sent.id)).toEqual({
      id: sent.id,
      kind: 'message',
      from: { id: sender, title: 'Checkout rewrite' },
      fromRunId: senderRun,
      to: { id: receiver, title: 'Orders API' },
      body: 'What does the endpoint return?',
      replyTo: null,
      state: 'waiting',
      deliveredAs: null,
      runId: null,
      noReplyReason: null,
      report: null,
      steeredAt: null,
      createdAt: expect.any(String),
      settledAt: null,
    });
  });

  it('has no state when no reply is wanted', async () => {
    const sent = ask({ wantsReply: false });
    await insertChatAsk(t.db, sent);

    expect((await getChatAsk(t.db, sent.id))?.state).toBeNull();
    expect(await settleChatAsk(t.db, sent.id, { state: 'replied' })).toBe(false);
  });

  it('keeps the first row when the same id is inserted again', async () => {
    const sent = ask();
    await insertChatAsk(t.db, sent);

    expect(await insertChatAsk(t.db, { ...sent, body: 'Something else' })).toBe(false);

    expect((await getChatAsk(t.db, sent.id))?.body).toBe('What does the endpoint return?');
    expect(await listChatAsks(t.db, receiver)).toHaveLength(1);
  });

  it('lists a chat’s asks in both directions, oldest first', async () => {
    const question = ask();
    await insertChatAsk(t.db, question);
    const reply = ask({
      kind: 'reply',
      fromConversationId: receiver,
      fromRunId: receiverRun,
      fromTitle: 'Orders API',
      toConversationId: sender,
      body: 'A list of orders.',
      replyTo: question.id,
      wantsReply: false,
    });
    await insertChatAsk(t.db, reply);
    await t.db.query(
      `UPDATE chat_asks SET created_at = now() + interval '1 second' WHERE id = $1`,
      [reply.id],
    );

    const both = [question.id, reply.id];
    expect((await listChatAsks(t.db, sender)).map((row) => row.id)).toEqual(both);
    expect((await listChatAsks(t.db, receiver)).map((row) => row.id)).toEqual(both);
    expect((await listChatAsks(t.db, receiver))[1]).toMatchObject({ replyTo: question.id });
  });

  it('shows on the detail of both chats', async () => {
    const sent = ask();
    await insertChatAsk(t.db, sent);
    const client = localClient(createTestApp(t));

    for (const chat of [sender, receiver]) {
      const detail = (await client.get(`/api/conversations/${chat}`).expect(200))
        .body as ConversationDetail;
      expect(detail.asks).toMatchObject([{ id: sent.id, state: 'waiting' }]);
    }
  });
});

describe('delivering an ask', () => {
  it('is recorded once with the run that took it', async () => {
    const sent = ask();
    await insertChatAsk(t.db, sent);

    expect(await markChatAskDelivered(t.db, sent.id, 'steer', receiverRun)).toBe(true);
    expect(await markChatAskDelivered(t.db, sent.id, 'turn', senderRun)).toBe(false);

    expect(await getChatAsk(t.db, sent.id)).toMatchObject({
      deliveredAs: 'steer',
      runId: receiverRun,
      state: 'waiting',
    });
  });
});

describe('settling an ask', () => {
  it('records a reply once', async () => {
    const sent = ask();
    await insertChatAsk(t.db, sent);

    expect(await settleChatAsk(t.db, sent.id, { state: 'replied' })).toBe(true);
    expect(await settleChatAsk(t.db, sent.id, { state: 'no_reply', reason: 'Stopped' })).toBe(
      false,
    );

    expect(await getChatAsk(t.db, sent.id)).toMatchObject({
      state: 'replied',
      noReplyReason: null,
      settledAt: expect.any(String),
    });
  });

  it('ends No reply with the reason', async () => {
    const sent = ask();
    await insertChatAsk(t.db, sent);

    await settleChatAsk(t.db, sent.id, { state: 'no_reply', reason: 'The turn was stopped.' });

    expect(await getChatAsk(t.db, sent.id)).toMatchObject({
      state: 'no_reply',
      noReplyReason: 'The turn was stopped.',
    });
  });

  it('answers false for an ask that does not exist', async () => {
    expect(await settleChatAsk(t.db, randomUUID(), { state: 'replied' })).toBe(false);
  });
});

describe('deleting a chat', () => {
  it('keeps an ask it sent, with its title, for the receiver', async () => {
    const sent = ask();
    await insertChatAsk(t.db, sent);

    await deleteConversation(t.db, t.workspaceId, sender);

    expect(await getChatAsk(t.db, sent.id)).toMatchObject({
      from: { id: null, title: 'Checkout rewrite' },
      fromRunId: null,
      to: { id: receiver },
    });
  });

  it('removes the asks it received and leaves a waiting sender a No reply notice', async () => {
    const sent = ask();
    await insertChatAsk(t.db, sent);

    await deleteConversation(t.db, t.workspaceId, receiver);

    expect(await getChatAsk(t.db, sent.id)).toBeNull();
    expect(await listChatAsks(t.db, sender)).toMatchObject([
      {
        kind: 'reply',
        from: { id: null, title: 'Orders API' },
        to: { id: sender },
        body: 'No reply: That chat was deleted.',
        state: null,
      },
    ]);
  });

  it('removes an ask that wanted no reply without a notice', async () => {
    const sent = ask({ wantsReply: false });
    await insertChatAsk(t.db, sent);

    await deleteConversation(t.db, t.workspaceId, receiver);

    expect(await listChatAsks(t.db, sender)).toEqual([]);
  });
});
