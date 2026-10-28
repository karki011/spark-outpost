import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postToOutpost } from '../src/outposts/post-service.ts';
import { createOutpost } from '../src/persistence/outposts.ts';
import { acceptTask } from '../src/persistence/outpost-tasks.ts';
import { saveAttachment } from '../src/persistence/attachments.ts';
import { addToQueue, listQueue, takeQueued } from '../src/persistence/chat-queue.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { drainQueue, sendNow } from '../src/workflow/queue-drain.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.cleanup();
});
const target = async () => ({ provider: 'fake' });
async function chat() {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Work' },
    await target(),
  );
  return { id: conversation.id, runId: sent.run.id };
}
async function attachment() {
  return saveAttachment(t.db, t.workspaceId, {
    name: 'notes.txt',
    mediaType: 'text/plain',
    data: Buffer.from('notes'),
  });
}

describe('queued attachment ownership', () => {
  it('reserves files across concurrent chats and retains same-id retries', async () => {
    const [first, second] = await Promise.all([chat(), chat()]);
    const file = await attachment();
    const requests = [first, second].map((conversation) => ({
      conversation,
      item: { id: randomUUID(), content: 'See', attachmentIds: [file.id] },
    }));
    const results = await Promise.allSettled(
      requests.map(({ conversation, item }) => addToQueue(t.db, conversation.id, item)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = requests[results.findIndex((result) => result.status === 'fulfilled')]!;
    await expect(addToQueue(t.db, winner.conversation.id, winner.item)).resolves.toBeUndefined();
    expect(await listQueue(t.db, winner.conversation.id)).toHaveLength(1);
    await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [
      winner.conversation.runId,
    ]);
    expect(await drainQueue(t.db, winner.conversation.id, target)).toBe('sent');
  });

  it('rejects normal sends and steers that reuse a queued file until its item is removed', async () => {
    const conversation = await chat();
    const file = await attachment();
    const id = randomUUID();
    await addToQueue(t.db, conversation.id, { id, content: 'See', attachmentIds: [file.id] });
    const request = { id: randomUUID(), content: 'Reuse', attachmentIds: [file.id] };
    await expect(sendNow(t.db, conversation.id, request, target)).rejects.toThrow(
      'another pending message',
    );
    await expect(sendUserMessage(t.db, conversation.id, request, await target())).rejects.toThrow(
      'another pending message',
    );
    await takeQueued(t.db, conversation.id, id);
    await expect(sendNow(t.db, conversation.id, request, target)).resolves.toBe('steering');
    await expect(sendNow(t.db, conversation.id, request, target)).resolves.toBe('steering');
    await expect(
      addToQueue(t.db, conversation.id, { ...request, id: randomUUID() }),
    ).rejects.toThrow('another pending message');
  });

  it('serializes a competing queued message and immediate steer', async () => {
    const [first, second] = await Promise.all([chat(), chat()]);
    const file = await attachment();
    const results = await Promise.allSettled([
      addToQueue(t.db, first.id, { id: randomUUID(), content: 'Queued', attachmentIds: [file.id] }),
      sendNow(
        t.db,
        second.id,
        { id: randomUUID(), content: 'Now', attachmentIds: [file.id] },
        target,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});

async function outpost(conversationId: string) {
  const id = randomUUID();
  await createOutpost(t.db, {
    id,
    workspaceId: t.workspaceId,
    name: 'Files',
    members: [{ conversationId, handle: 'builder' }],
  });
  return (attachmentId: string, postId = randomUUID()) =>
    postToOutpost(
      { db: t.db, workspaceId: t.workspaceId },
      {
        id: postId,
        outpostId: id,
        author: { kind: 'user' },
        text: 'See file',
        toConversationId: conversationId,
        attachmentIds: [attachmentId],
      },
    );
}

describe('outpost attachment ownership', () => {
  it('keeps an outpost file reserved while allowing its own queued request to drain', async () => {
    const conversation = await chat();
    const post = await outpost(conversation.id);
    const file = await attachment();
    const id = randomUUID();
    await post(file.id, id);
    await expect(post(file.id, id)).resolves.toHaveLength(1);
    const request = { id: randomUUID(), content: 'Reuse', attachmentIds: [file.id] };
    await expect(addToQueue(t.db, conversation.id, request)).rejects.toThrow('pending message');
    await expect(sendNow(t.db, conversation.id, request, target)).rejects.toThrow(
      'pending message',
    );
    await expect(sendUserMessage(t.db, conversation.id, request, await target())).rejects.toThrow(
      'pending message',
    );
    await acceptTask(t.db, conversation.id, { messageId: id, contextId: null, text: 'See file' });
    await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [conversation.runId]);
    expect(await drainQueue(t.db, conversation.id, target)).toBe('sent');
    const linked = await t.db.query('SELECT message_id FROM attachments WHERE id = $1', [file.id]);
    expect(linked.rows[0].message_id).toBeNull();
    const delivered = await t.db.query('SELECT data FROM attachments WHERE message_id = $1', [id]);
    expect(delivered.rows[0].data.toString()).toBe('notes');
  });

  it.each(['queued', 'steering'] as const)('rejects outpost reuse of a %s file', async (mode) => {
    const conversation = await chat();
    const post = await outpost(conversation.id);
    const file = await attachment();
    const request = { id: randomUUID(), content: 'File', attachmentIds: [file.id] };
    if (mode === 'queued') await addToQueue(t.db, conversation.id, request);
    else await sendNow(t.db, conversation.id, request, target);
    await expect(post(file.id)).rejects.toThrow('missing or already sent');
  });

  it('serializes concurrent outpost and chat admission of one file', async () => {
    const conversation = await chat();
    const post = await outpost(conversation.id);
    const file = await attachment();
    const results = await Promise.allSettled([
      post(file.id),
      addToQueue(t.db, conversation.id, {
        id: randomUUID(),
        content: 'File',
        attachmentIds: [file.id],
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});

it('delivers an outpost file independently to every fanout recipient', async () => {
  const [first, second] = await Promise.all([chat(), chat()]);
  const outpostId = randomUUID();
  await createOutpost(t.db, {
    id: outpostId,
    workspaceId: t.workspaceId,
    name: 'Fanout',
    members: [
      { conversationId: first.id, handle: 'first' },
      { conversationId: second.id, handle: 'second' },
    ],
  });
  const file = await attachment();
  const posts = await postToOutpost(
    { db: t.db, workspaceId: t.workspaceId },
    { outpostId, author: { kind: 'user' }, text: '@all See file', attachmentIds: [file.id] },
  );
  expect(posts).toHaveLength(2);
  for (const post of posts) {
    await acceptTask(t.db, post.toConversationId!, {
      messageId: post.id,
      contextId: outpostId,
      text: post.body,
    });
  }
  await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = ANY($1::uuid[])", [
    [first.runId, second.runId],
  ]);
  expect(
    await Promise.all([drainQueue(t.db, first.id, target), drainQueue(t.db, second.id, target)]),
  ).toEqual(['sent', 'sent']);
  const copies = await t.db.query(
    'SELECT id, data FROM attachments WHERE message_id = ANY($1::uuid[])',
    [posts.map((post) => post.id)],
  );
  expect(copies.rows).toHaveLength(2);
  expect(new Set(copies.rows.map((row) => row.id)).size).toBe(2);
  expect(copies.rows.every((row) => row.data.toString() === 'notes' && row.id !== file.id)).toBe(
    true,
  );
});

it('does not let another chat consume a reservation by reusing its message ID', async () => {
  const [first, second] = await Promise.all([chat(), chat()]);
  const file = await attachment();
  const request = { id: randomUUID(), content: 'Reserved', attachmentIds: [file.id] };
  await addToQueue(t.db, first.id, request);
  await expect(sendNow(t.db, second.id, request, target)).rejects.toThrow('another chat');
  await expect(sendUserMessage(t.db, second.id, request, await target())).rejects.toThrow(
    'pending message',
  );
  await expect(addToQueue(t.db, second.id, request)).rejects.toThrow('another chat');
  expect(await listQueue(t.db, first.id)).toHaveLength(1);
  await expect(sendNow(t.db, first.id, request, target)).resolves.toBe('steering');
});

it('rejects cross-chat retries of accepted steers and sent messages', async () => {
  const [first, second] = await Promise.all([chat(), chat()]);
  const request = { id: randomUUID(), content: 'Steer' };
  await expect(sendNow(t.db, first.id, request, target)).resolves.toBe('steering');
  await expect(sendNow(t.db, second.id, request, target)).rejects.toThrow('another chat');
  await expect(sendNow(t.db, first.id, request, target)).resolves.toBe('steering');
  const sent = { id: randomUUID(), content: 'Sent' };
  await sendUserMessage(t.db, first.id, sent, await target());
  await expect(sendNow(t.db, second.id, sent, target)).rejects.toThrow('another chat');
  await expect(sendNow(t.db, first.id, sent, target)).resolves.toBe('sent');
});

it('rejects foreign text-only queue retries and concurrent cross-chat IDs', async () => {
  const [first, second] = await Promise.all([chat(), chat()]);
  const queued = { id: randomUUID(), content: 'Queued' };
  await addToQueue(t.db, first.id, queued);
  await expect(addToQueue(t.db, second.id, queued)).rejects.toThrow('another chat');
  await expect(addToQueue(t.db, first.id, queued)).resolves.toBeUndefined();
  const sent = { id: randomUUID(), content: 'Sent' };
  await sendUserMessage(t.db, first.id, sent, await target());
  await expect(addToQueue(t.db, second.id, sent)).rejects.toThrow('another chat');
  const shared = { id: randomUUID(), content: 'Concurrent' };
  const results = await Promise.allSettled([
    addToQueue(t.db, first.id, shared),
    sendNow(t.db, second.id, shared, target),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
});
