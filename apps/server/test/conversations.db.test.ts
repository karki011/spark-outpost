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
import { reserveNativeTerminalLaunch } from '../src/persistence/native-terminal-turns.ts';
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

  it('rejects a reused id that belongs to a message that is not a sent user message', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const reply = randomUUID();
    const note = randomUUID();
    await t.db.query(
      `INSERT INTO messages (id, conversation_id, role, content)
       VALUES ($1, $3, 'assistant', 'Done'), ($2, $3, 'user', 'No run')`,
      [reply, note, conversation.id],
    );

    for (const [id, content] of [
      [reply, 'Done'],
      [note, 'No run'],
    ] as const) {
      await expect(
        sendUserMessage(t.db, conversation.id, { id, content }, { provider: 'fake' }),
      ).rejects.toBeInstanceOf(MessageConflictError);
    }
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
  it('treats a Terminal session that never launched like an empty chat', async () => {
    const options = { sessionType: 'terminal', terminalProvider: 'claude' } as const;
    const failed = await createConversation(t.db, t.workspaceId, randomUUID(), options);
    const launched = await createConversation(t.db, t.workspaceId, randomUUID(), options);
    await reserveNativeTerminalLaunch(t.db, {
      id: randomUUID(),
      conversationId: launched.id,
      provider: 'claude',
      cwd: '/tmp',
      label: 'Session',
      runId: null,
      messageId: null,
      observation: 'unsupported',
      reason: null,
      resume: false,
    });

    const listed = await listConversations(t.db, t.workspaceId);
    expect(listed.map((item) => item.id)).toEqual([launched.id]);

    await t.db.query(`UPDATE conversations SET updated_at = now() - interval '2 days'`);
    await pruneEmptyConversations(t.db, t.workspaceId);
    expect(await getConversationDetail(t.db, failed.id)).toBeNull();
    expect(await getConversationDetail(t.db, launched.id)).not.toBeNull();
  });
});

describe('the pull request state a chat row carries', () => {
  let pulls = 0;

  async function chatWithPulls(states: readonly string[]) {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: 'Tidy the notes' },
      { provider: 'fake' },
    );
    for (const state of states) {
      pulls += 1;
      await t.db.query(
        `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number,
           url, branch, pr_state)
         VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', $4, $5, 'spark/tidy', $6)`,
        [
          randomUUID(),
          t.workspaceId,
          conversation.id,
          pulls,
          `https://github.com/acme/widgets/pull/${pulls}`,
          state,
        ],
      );
    }
    return conversation.id;
  }

  it('says merged once a pull request merged and none is still open', async () => {
    const none = await chatWithPulls([]);
    const open = await chatWithPulls(['open']);
    const merged = await chatWithPulls(['merged']);
    const closed = await chatWithPulls(['closed']);
    const mergedAndOpen = await chatWithPulls(['merged', 'open']);
    const mergedAndClosed = await chatWithPulls(['closed', 'merged']);

    const listed = await listConversations(t.db, t.workspaceId);
    const state = new Map(listed.map((chat) => [chat.id, chat.pullRequestMerged]));
    expect(state.get(none)).toBe(false);
    expect(state.get(open)).toBe(false);
    expect(state.get(closed)).toBe(false);
    expect(state.get(mergedAndOpen)).toBe(false);
    expect(state.get(merged)).toBe(true);
    expect(state.get(mergedAndClosed)).toBe(true);
  });
});
