import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

it('rejects queue retries of an accepted steer without blocking its later delivery', async () => {
  const conversation = await chat();
  const file = await attachment();
  const request = { id: randomUUID(), content: 'Original', attachmentIds: [file.id] };
  await expect(sendNow(t.db, conversation.id, request, target)).resolves.toBe('steering');
  await expect(addToQueue(t.db, conversation.id, request)).rejects.toThrow('already accepted');
  await expect(
    addToQueue(t.db, conversation.id, { ...request, content: 'Changed' }),
  ).rejects.toThrow('already accepted');
  expect(await listQueue(t.db, conversation.id)).toEqual([]);
  await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [conversation.runId]);
  expect(await drainQueue(t.db, conversation.id, target)).toBe('sent');
  await t.db.query("UPDATE runs SET status = 'succeeded' WHERE conversation_id = $1", [
    conversation.id,
  ]);
  expect(await drainQueue(t.db, conversation.id, target)).toBe('empty');
  const delivered = await t.db.query('SELECT content FROM messages WHERE id = $1', [request.id]);
  expect(delivered.rows[0].content).toBe('Original');
});
