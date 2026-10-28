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
