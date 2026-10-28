import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveAttachment,
  attachmentFilesForMessages,
  pruneUnlinkedAttachments,
} from '../src/persistence/attachments.ts';
import { addToQueue, editQueued, listQueue } from '../src/persistence/chat-queue.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { getMemberMessage } from '../src/persistence/member-messages.ts';
import * as attachmentStore from '../src/persistence/attachments.ts';
import { drainQueue, resendMissed, sendNow } from '../src/workflow/queue-drain.ts';
import { openMemberInbox } from '../src/workflow/member-inbox.ts';
import { listAnnotations } from '../src/persistence/annotations.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.cleanup();
});
const target = async () => ({ provider: 'fake' });
async function setup() {
  const chat = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    chat.id,
    { id: randomUUID(), content: 'Work' },
    await target(),
  );
  const file = await saveAttachment(t.db, t.workspaceId, {
    name: 'notes.txt',
    mediaType: 'text/plain',
    data: Buffer.from('attached context'),
  });
  return { conversationId: chat.id, runId: sent.run.id, file };
}

describe('attachments during an active turn', () => {
  it('retains image-only-style queued drafts through pruning and sends their file next turn', async () => {
    const { conversationId, runId, file } = await setup();
    const id = randomUUID();
    await addToQueue(t.db, conversationId, { id, content: '', attachmentIds: [file.id] });
    await t.db.query(
      "UPDATE attachments SET created_at = now() - interval '2 days' WHERE id = $1",
      [file.id],
    );
    await pruneUnlinkedAttachments(t.db, t.workspaceId);
    expect(await drainQueue(t.db, conversationId, target)).toBe('busy');
    expect((await listQueue(t.db, conversationId))[0]?.attachmentIds).toEqual([file.id]);
    await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [runId]);
    expect(await drainQueue(t.db, conversationId, target)).toBe('sent');
    expect((await attachmentFilesForMessages(t.db, [id])).get(id)?.[0]?.data.toString()).toBe(
      'attached context',
    );
  });

  it('delivers the actual attachment to an active inbox without stopping the run', async () => {
    const { conversationId, runId, file } = await setup();
    const id = randomUUID();
    expect(
      await sendNow(t.db, conversationId, { id, content: '', attachmentIds: [file.id] }, target),
    ).toBe('steering');
    expect(
      await sendNow(t.db, conversationId, { id, content: '', attachmentIds: [file.id] }, target),
    ).toBe('steering');
    const inbox = openMemberInbox(t.db, {
      conversationId,
      runId,
      topRunId: runId,
      pollMs: 60_000,
      append: async () => null,
    });
    try {
      expect(await inbox.take()).toMatchObject({
        attachments: [{ name: 'notes.txt', data: Buffer.from('attached context') }],
      });
      expect((await getMemberMessage(t.db, id))?.status).toBe('delivered');
      expect(
        (await t.db.query('SELECT cancel_requested_at FROM runs WHERE id = $1', [runId])).rows[0]
          ?.cancel_requested_at,
      ).toBeNull();
    } finally {
      await inbox.dispose();
    }
  });

  it('preserves an unclaimed steer through turn completion into the next turn', async () => {
    const { conversationId, runId, file } = await setup();
    const id = randomUUID();
    await sendNow(
      t.db,
      conversationId,
      { id, content: 'See this', attachmentIds: [file.id] },
      target,
    );
    await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [runId]);
    expect(await drainQueue(t.db, conversationId, target)).toBe('sent');
    expect((await attachmentFilesForMessages(t.db, [id])).get(id)?.[0]?.id).toBe(file.id);
  });

  it('queues files when steering is unavailable and keeps background work running', async () => {
    const { conversationId, runId, file } = await setup();
    const id = randomUUID();
    await sendNow(
      t.db,
      conversationId,
      { id, content: 'See this', attachmentIds: [file.id] },
      target,
    );
    const inbox = openMemberInbox(t.db, {
      conversationId,
      runId,
      topRunId: runId,
      pollMs: 10,
      append: async () => null,
    });
    try {
      await expect
        .poll(async () => (await listQueue(t.db, conversationId)).map((item) => item.id))
        .toEqual([id]);
      expect((await listQueue(t.db, conversationId))[0]?.attachmentIds).toEqual([file.id]);
      expect(
        (await t.db.query('SELECT cancel_requested_at FROM runs WHERE id = $1', [runId])).rows[0]
          ?.cancel_requested_at,
      ).toBeNull();
    } finally {
      await inbox.dispose();
    }
  });

  it('accepts file-only requests over HTTP and rejects foreign workspace files', async () => {
    const { conversationId, file } = await setup();
    const app = localClient(createTestApp(t));
    const id = randomUUID();
    expect(
      (
        await app.send('post', `/api/conversations/${conversationId}/queue`, {
          id,
          content: '',
          attachmentIds: [file.id],
        })
      ).status,
    ).toBe(201);
    const workspaceId = randomUUID();
    await t.db.query("INSERT INTO workspaces (id, slug, name) VALUES ($1, 'foreign', 'Foreign')", [
      workspaceId,
    ]);
    const foreign = await saveAttachment(t.db, workspaceId, {
      name: 'foreign.txt',
      mediaType: 'text/plain',
      data: Buffer.from('private'),
    });
    expect(
      (
        await app.send('post', `/api/conversations/${conversationId}/queue/send-now`, {
          id: randomUUID(),
          content: '',
          attachmentIds: [foreign.id],
        })
      ).status,
    ).toBe(400);
    expect((await listQueue(t.db, conversationId)).map((item) => item.id)).toEqual([id]);
  });

  it('retains quoted message annotations through an unsent steer and next-turn delivery', async () => {
    const { conversationId, runId, file } = await setup();
    const source = (
      await t.db.query<{ id: string }>('SELECT id FROM messages WHERE conversation_id = $1', [
        conversationId,
      ])
    ).rows[0]!;
    const id = randomUUID();
    const annotation = {
      id: randomUUID(),
      sourceMessageId: source.id,
      kind: 'quote' as const,
      quote: 'Work',
      note: '',
      anchor: { exact: 'Work', prefix: '', suffix: '', start: 0, end: 4 },
    };
    await sendNow(
      t.db,
      conversationId,
      { id, content: 'See this', attachmentIds: [file.id], annotations: [annotation] },
      target,
    );
    expect((await getMemberMessage(t.db, id))?.annotations).toEqual([annotation]);
    await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [runId]);
    await drainQueue(t.db, conversationId, target);
    expect(await listAnnotations(t.db, conversationId)).toMatchObject([
      { id: annotation.id, messageId: id, sourceMessageId: source.id },
    ]);
  });

  it('does not mark an attachment delivered when loading its content fails', async () => {
    const { conversationId, runId, file } = await setup();
    const id = randomUUID();
    await sendNow(t.db, conversationId, { id, content: '', attachmentIds: [file.id] }, target);
    await t.db.query('DELETE FROM attachments WHERE id = $1', [file.id]);
    const inbox = openMemberInbox(t.db, {
      conversationId,
      runId,
      topRunId: runId,
      pollMs: 60_000,
      append: async () => null,
    });
    try {
      await expect(inbox.take()).resolves.toBeNull();
      expect((await getMemberMessage(t.db, id))?.status).toBe('missed');
      await expect(inbox.take()).resolves.toBeNull();
      expect((await getMemberMessage(t.db, id))?.status).toBe('missed');
    } finally {
      await inbox.dispose();
    }
  });

  it.each([false, true])(
    'shows a recoverable missed attachment without polling it again, steering=%s',
    async (steering) => {
      const { conversationId, runId, file } = await setup();
      const id = randomUUID();
      await sendNow(
        t.db,
        conversationId,
        { id, content: 'Read this', attachmentIds: [file.id] },
        target,
      );
      await t.db.query('DELETE FROM attachments WHERE id = $1', [file.id]);
      const statuses: string[] = [];
      let delivered = 0;
      const inbox = openMemberInbox(t.db, {
        conversationId,
        runId,
        topRunId: runId,
        pollMs: 10,
        append: async (event) => {
          const content = (event as { content?: { status?: string } }).content;
          if (content?.status) statuses.push(content.status);
          return null;
        },
      });
      if (steering)
        inbox.attach(async () => {
          delivered += 1;
          return true;
        });
      try {
        await expect.poll(async () => (await getMemberMessage(t.db, id))?.status).toBe('missed');
        await expect(inbox.take()).resolves.toBeNull();
        expect(delivered).toBe(0);
        expect(
          (await t.db.query('SELECT cancel_requested_at FROM runs WHERE id = $1', [runId])).rows[0]
            ?.cancel_requested_at,
        ).toBeNull();
        expect(await listQueue(t.db, conversationId)).toEqual([]);
        expect(statuses).toEqual(['missed']);
      } finally {
        await inbox.dispose();
      }
    },
  );

  it('keeps a transient attachment-read failure recoverable without failing the lead turn', async () => {
    const { conversationId, runId, file } = await setup();
    const id = randomUUID();
    await sendNow(
      t.db,
      conversationId,
      { id, content: 'Read these notes', attachmentIds: [file.id] },
      target,
    );
    const load = vi
      .spyOn(attachmentStore, 'getAttachmentContent')
      .mockRejectedValueOnce(new Error('temporary storage read failure'));
    const inbox = openMemberInbox(t.db, {
      conversationId,
      runId,
      topRunId: runId,
      pollMs: 60_000,
      append: async () => null,
    });
    try {
      await expect(inbox.take()).resolves.toBeNull();
      expect(await getMemberMessage(t.db, id)).toMatchObject({
        status: 'missed',
        body: 'Read these notes',
        attachmentIds: [file.id],
      });
      await expect(inbox.take()).resolves.toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
      load.mockRestore();
      expect(await resendMissed(t.db, conversationId, id, target)).toBe('queued');
      expect((await listQueue(t.db, conversationId))[0]).toMatchObject({
        id,
        content: 'Read these notes',
        attachmentIds: [file.id],
      });
      expect(
        (await t.db.query('SELECT cancel_requested_at FROM runs WHERE id = $1', [runId])).rows[0]
          ?.cancel_requested_at,
      ).toBeNull();
      await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [runId]);
      expect(await drainQueue(t.db, conversationId, target)).toBe('sent');
      expect((await attachmentFilesForMessages(t.db, [id])).get(id)?.[0]?.data.toString()).toBe(
        'attached context',
      );
      expect(await listQueue(t.db, conversationId)).toEqual([]);
    } finally {
      load.mockRestore();
      await inbox.dispose();
    }
  });

  it('allows removing queued text only when an attachment remains', async () => {
    const { conversationId, file } = await setup();
    const id = randomUUID();
    await addToQueue(t.db, conversationId, { id, content: 'See', attachmentIds: [file.id] });
    await editQueued(t.db, conversationId, id, '');
    expect((await listQueue(t.db, conversationId))[0]).toMatchObject({
      content: '',
      attachmentIds: [file.id],
    });
    const plain = randomUUID();
    await addToQueue(t.db, conversationId, { id: plain, content: 'Keep me' });
    await expect(editQueued(t.db, conversationId, plain, '')).rejects.toThrow('Keep a message');
  });

  it('keeps attachment metadata on continued queued message markers', async () => {
    const { conversationId, runId, file } = await setup();
    const id = randomUUID();
    const source = (
      await t.db.query<{ id: string }>('SELECT id FROM messages WHERE conversation_id = $1', [
        conversationId,
      ])
    ).rows[0]!;
    const annotation = {
      id: randomUUID(),
      sourceMessageId: source.id,
      kind: 'quote' as const,
      quote: 'Work',
      note: '',
      anchor: { exact: 'Work', prefix: '', suffix: '', start: 0, end: 4 },
    };
    await addToQueue(t.db, conversationId, {
      id,
      content: 'Continue with notes',
      attachmentIds: [file.id],
      annotations: [annotation],
      continueRunId: runId,
    });
    await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [runId]);
    expect(await drainQueue(t.db, conversationId, target)).toBe('sent');
    expect(await getMemberMessage(t.db, id)).toMatchObject({
      status: 'continued',
      messageId: id,
      attachmentIds: [file.id],
      annotations: [annotation],
    });
    expect((await attachmentFilesForMessages(t.db, [id])).get(id)?.[0]?.id).toBe(file.id);
  });

  it('rejects missing and already-linked attachments before accepting a queued or immediate draft', async () => {
    const { conversationId, file } = await setup();
    await expect(
      addToQueue(t.db, conversationId, {
        id: randomUUID(),
        content: '',
        attachmentIds: [randomUUID()],
      }),
    ).rejects.toThrow('missing or already sent');
    const other = await createConversation(t.db, t.workspaceId, randomUUID());
    await sendUserMessage(
      t.db,
      other.id,
      { id: randomUUID(), content: 'File', attachmentIds: [file.id] },
      await target(),
    );
    await expect(
      sendNow(
        t.db,
        conversationId,
        { id: randomUUID(), content: '', attachmentIds: [file.id] },
        target,
      ),
    ).rejects.toThrow('missing or already sent');
    expect(await listQueue(t.db, conversationId)).toEqual([]);
  });
});
