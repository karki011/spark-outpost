import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MessageConflictError,
  createConversation,
  getConversationDetail,
  listConversations,
  pruneEmptyConversations,
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

describe('sending messages', () => {
  it('returns the same run when the same message is sent twice', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const request = { id: randomUUID(), content: 'Fix the flaky test' };

    const [first, second] = await Promise.all([
      sendUserMessage(t.db, conversation.id, request, { provider: 'fake' }),
      sendUserMessage(t.db, conversation.id, request, { provider: 'fake' }),
    ]);

    expect(second.run.id).toBe(first.run.id);
    const jobs = await t.db.query('SELECT id FROM jobs');
    expect(jobs.rowCount).toBe(1);
  });

  it('rejects a reused message id with different content', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const id = randomUUID();
    await sendUserMessage(t.db, conversation.id, { id, content: 'first' }, { provider: 'fake' });

    await expect(
      sendUserMessage(t.db, conversation.id, { id, content: 'second' }, { provider: 'fake' }),
    ).rejects.toBeInstanceOf(MessageConflictError);
  });

  it('titles an untitled chat from its first message only', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: 'Plan the release\nmore' },
      { provider: 'fake' },
    );
    await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: 'Something else' },
      { provider: 'fake' },
    );

    const detail = await getConversationDetail(t.db, conversation.id);
    expect(detail?.conversation.title).toBe('Plan the release');
    expect(detail?.runs).toHaveLength(2);
  });

  it('creating the same conversation twice is idempotent', async () => {
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    await createConversation(t.db, t.workspaceId, id);
    const { rowCount } = await t.db.query('SELECT 1 FROM conversations WHERE id = $1', [id]);
    expect(rowCount).toBe(1);
  });
});

describe('draft chats', () => {
  it('saves a new chat only when its first message is sent, titled from that message', async () => {
    const id = randomUUID();
    expect(await getConversationDetail(t.db, id)).toBeNull();

    await sendUserMessage(
      t.db,
      id,
      { id: randomUUID(), content: 'Sketch the onboarding flow\ndetails' },
      { provider: 'fake' },
      t.workspaceId,
    );

    const detail = await getConversationDetail(t.db, id);
    expect(detail?.conversation.title).toBe('Sketch the onboarding flow');
    expect(detail?.messages).toHaveLength(1);
  });

  it('keeps chats without messages out of the list and prunes old ones', async () => {
    const empty = await createConversation(t.db, t.workspaceId, randomUUID());
    const used = randomUUID();
    await sendUserMessage(
      t.db,
      used,
      { id: randomUUID(), content: 'hello' },
      { provider: 'fake' },
      t.workspaceId,
    );

    const listed = await listConversations(t.db, t.workspaceId);
    expect(listed.map((item) => item.id)).toEqual([used]);

    await t.db.query(
      `UPDATE conversations SET updated_at = now() - interval '2 days' WHERE id = $1`,
      [empty.id],
    );
    await pruneEmptyConversations(t.db, t.workspaceId);
    expect(await getConversationDetail(t.db, empty.id)).toBeNull();
    expect(await getConversationDetail(t.db, used)).not.toBeNull();
  });
});
