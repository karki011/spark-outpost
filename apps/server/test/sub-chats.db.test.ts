import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConversationDetail,
  ConversationSummary,
  SubChatReport,
  SubChatsResponse,
} from '@spark-outpost/contracts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { pruneEmptyConversations } from '../src/persistence/conversations.ts';
import { withTransaction } from '../src/persistence/db.ts';
import {
  ALREADY_A_SUB_CHAT,
  getSubChat,
  insertSubChat,
  listSubChats,
  markSubChatStarted,
  PARENT_CANNOT_BE_SUB_CHAT,
  saveSubChatReport,
  SUB_CHAT_CANNOT_BE_PARENT,
  type NewSubChat,
} from '../src/persistence/sub-chats.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  addPullRequest,
  addSubChat,
  emptyChat,
  STARTED_WITH,
  turnIn,
} from './sub-chat-fixtures.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let parent: string;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  parent = (await startChat(t, 'Checkout rewrite')).conversationId;
});

afterEach(async () => {
  await t.cleanup();
});

const REPORT: SubChatReport = {
  status: 'ready_for_review',
  reason: null,
  changed: 'Added the endpoint.',
  risks: 'None stated',
  blockers: 'None stated',
  said: '',
  branch: 'spark/piece',
  committed: true,
  pushed: true,
  pullRequest: null,
};

function link(conversationId: string, parentConversationId: string): NewSubChat {
  return {
    conversationId,
    parentConversationId,
    task: 'Build it.',
    stackedOn: null,
    startsAfter: [],
    startedWith: STARTED_WITH,
    approvalId: null,
  };
}

function refusal(input: NewSubChat): Promise<unknown> {
  return withTransaction(t.db, (client) => insertSubChat(client, input)).catch(
    (error: unknown) => (error as Error).message,
  );
}

async function start(conversationId: string): Promise<void> {
  expect(await markSubChatStarted(t.db, conversationId, randomUUID())).toBe(true);
}

async function rows(): Promise<SubChatsResponse['subChats']> {
  const response = await localClient(app).get(`/api/conversations/${parent}/sub-chats`).expect(200);
  return (response.body as SubChatsResponse).subChats;
}

async function listed(): Promise<ConversationSummary[]> {
  return (await localClient(app).get('/api/conversations').expect(200))
    .body as ConversationSummary[];
}

async function summaryOf(id: string): Promise<ConversationSummary> {
  return (await listed()).find((chat) => chat.id === id)!;
}

describe('the sub-chats of a parent', () => {
  it('are stored in the order they were added, with the plan and what they started with', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    const web = await addSubChat(t, parent, 'Web', { stackedOn: api });
    const docs = await addSubChat(t, parent, 'Docs', { startsAfter: [api, web] });

    expect(await listSubChats(t.db, parent)).toMatchObject([
      { conversationId: api, position: 0, parentTitle: 'Checkout rewrite', startedAt: null },
      { conversationId: web, position: 1, stackedOn: api },
      { conversationId: docs, position: 2, startsAfter: [api, web], startedWith: STARTED_WITH },
    ]);
  });

  it('start once, and keep the first task ask', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    const ask = randomUUID();

    expect(await markSubChatStarted(t.db, api, ask)).toBe(true);
    expect(await markSubChatStarted(t.db, api, randomUUID())).toBe(false);

    expect(await getSubChat(t.db, api)).toMatchObject({
      taskAskId: ask,
      startedAt: expect.any(Date),
    });
  });

  it('keep the latest report', async () => {
    const api = await addSubChat(t, parent, 'Orders API');

    await saveSubChatReport(t.db, api, REPORT);
    await saveSubChatReport(t.db, api, { ...REPORT, changed: 'Added paging.' });

    expect(await getSubChat(t.db, api)).toMatchObject({
      report: { ...REPORT, changed: 'Added paging.' },
      reportedAt: expect.any(Date),
    });
    expect(await saveSubChatReport(t.db, randomUUID(), REPORT)).toBe(false);
  });
});

describe('one level only', () => {
  it('refuses a sub-chat as a parent', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    const nested = await emptyChat(t, 'Nested');

    expect(await refusal(link(nested, api))).toBe(SUB_CHAT_CANNOT_BE_PARENT);
    expect(await getSubChat(t.db, nested)).toBeNull();
  });

  it('refuses to put a parent under another chat', async () => {
    await addSubChat(t, parent, 'Orders API');
    const other = (await startChat(t, 'Other work')).conversationId;

    expect(await refusal(link(parent, other))).toBe(PARENT_CANNOT_BE_SUB_CHAT);
  });

  it('refuses a second parent for the same chat', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    const other = (await startChat(t, 'Other work')).conversationId;

    expect(await refusal(link(api, other))).toBe(ALREADY_A_SUB_CHAT);
    expect((await getSubChat(t.db, api))?.parentConversationId).toBe(parent);
  });
});

describe('the sub-chats route and the chat list', () => {
  it('returns three sub-chats in order with their statuses', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    const web = await addSubChat(t, parent, 'Web', { stackedOn: api });
    const docs = await addSubChat(t, parent, 'Docs', { startsAfter: [api, web] });
    await start(api);
    await turnIn(t, api, 'succeeded');
    await addPullRequest(t, api, 'open', 12);
    await start(web);
    await turnIn(t, web, 'failed');

    expect(await rows()).toMatchObject([
      {
        id: api,
        title: 'Orders API',
        position: 0,
        status: 'ready_for_review',
        why: null,
        task: 'Build Orders API.',
        pullRequest: { number: 12, state: 'open', checks: 'passing' },
        startedWith: STARTED_WITH,
        stackedOn: null,
        startsAfter: [],
        startedAt: expect.any(String),
      },
      {
        id: web,
        status: 'needs_you',
        why: 'The agent crashed.',
        stackedOn: { id: api, title: 'Orders API' },
      },
      {
        id: docs,
        title: 'Docs',
        status: 'held',
        startedAt: null,
        startsAfter: [
          { id: api, title: 'Orders API' },
          { id: web, title: 'Web' },
        ],
      },
    ]);

    const chats = await listed();
    const inList = (id: string) => chats.find((chat) => chat.id === id);
    expect(inList(parent)).toMatchObject({ subChatCount: 3 });
    expect(inList(parent)?.subChat).toBeUndefined();
    expect(inList(api)).toMatchObject({
      parent: { id: parent, title: 'Checkout rewrite' },
      subChat: { position: 0, status: 'ready_for_review' },
    });
    expect(inList(web)?.subChat).toEqual({ position: 1, status: 'needs_you' });
    expect(inList(docs)?.subChat).toEqual({ position: 2, status: 'held' });
  });

  it('follows a sub-chat through Working, a stopped turn, a merged pull request and its report', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    await start(api);
    await t.db.query(
      `INSERT INTO chat_queue (id, conversation_id, position, content, origin)
       VALUES ($1, $2, 1, 'Build it.', 'chat')`,
      [randomUUID(), api],
    );
    expect((await rows())[0]).toMatchObject({ status: 'working' });

    await t.db.query('DELETE FROM chat_queue WHERE conversation_id = $1', [api]);
    const runId = await turnIn(t, api, 'cancelled');
    expect((await rows())[0]).toMatchObject({
      status: 'needs_you',
      why: 'Its last turn was stopped.',
    });

    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    await addPullRequest(t, api, 'merged', 14);
    await saveSubChatReport(t.db, api, REPORT);
    expect((await rows())[0]).toMatchObject({
      status: 'done',
      pullRequest: { number: 14, state: 'merged' },
      report: REPORT,
      reportedAt: expect.any(String),
    });
  });

  it('uses the parent’s current title after a rename', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    await t.db.query(`UPDATE conversations SET title = 'Checkout v2' WHERE id = $1`, [parent]);

    expect((await summaryOf(api)).parent).toEqual({ id: parent, title: 'Checkout v2' });
  });

  it('lists a Held sub-chat that has no message yet, and never prunes it as empty', async () => {
    const docs = await addSubChat(t, parent, 'Docs');
    await t.db.query(
      `UPDATE conversations SET updated_at = now() - interval '3 days' WHERE id = $1`,
      [docs],
    );

    await pruneEmptyConversations(t.db, t.workspaceId);

    expect((await summaryOf(docs)).subChat).toEqual({ position: 0, status: 'held' });
  });

  it('answers 404 for a chat that does not exist and an empty list for a plain chat', async () => {
    await localClient(app).get(`/api/conversations/${randomUUID()}/sub-chats`).expect(404);
    expect(await rows()).toEqual([]);
  });

  it('carries the parent on a sub-chat’s detail', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    const detail = (await localClient(app).get(`/api/conversations/${api}`).expect(200))
      .body as ConversationDetail;

    expect(detail.conversation.parent).toEqual({ id: parent, title: 'Checkout rewrite' });
    expect(detail.conversation.subChat).toEqual({ position: 0, status: 'held' });
  });
});

describe('deleting', () => {
  it('a parent keeps its sub-chats as plain chats that remember its latest title', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    await start(api);
    await turnIn(t, api, 'succeeded');
    await t.db.query(`UPDATE conversations SET title = 'Checkout v2' WHERE id = $1`, [parent]);

    await deleteConversation(t.db, t.workspaceId, parent);

    const kept = await summaryOf(api);
    expect(kept.parent).toBeUndefined();
    expect(kept.formerParent).toEqual({ title: 'Checkout v2' });
    expect(kept.subChat).toEqual({ position: 0, status: 'done' });
    expect(await getSubChat(t.db, api)).toMatchObject({
      parentConversationId: null,
      parentTitle: 'Checkout v2',
    });
  });

  it('a sub-chat removes its row and frees the ones stacked on it', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    const web = await addSubChat(t, parent, 'Web', { stackedOn: api, startsAfter: [api] });

    await deleteConversation(t.db, t.workspaceId, api);

    expect(await getSubChat(t.db, api)).toBeNull();
    expect(await listSubChats(t.db, parent)).toMatchObject([
      { conversationId: web, position: 1, stackedOn: null, startsAfter: [api] },
    ]);
    expect(await rows()).toMatchObject([{ id: web, stackedOn: null, startsAfter: [] }]);
    expect((await summaryOf(parent)).subChatCount).toBe(1);
  });
});
