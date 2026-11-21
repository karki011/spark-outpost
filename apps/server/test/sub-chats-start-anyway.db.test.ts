import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SubChatsResponse } from '@spark-outpost/contracts';
import { NOT_THIS_CHATS_SUB_CHAT } from '../src/sub-chats/start.ts';
import { createTestApp, localClient } from './app-support.ts';
import { askNow, turnsOf } from './chat-ask-fixtures.ts';
import { emptyChat } from './sub-chat-fixtures.ts';
import {
  PARENT_TITLE,
  parentChat,
  projectAt,
  startedPlan,
  subChatsOf,
  THREE_PIECES,
  type ParentChat,
  type SubChatRecord,
} from './sub-chat-plan-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let scratch: string;
let parent: ParentChat;
let api: SubChatRecord;
let page: SubChatRecord;
let docs: SubChatRecord;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await connectCliProvider(t, 'claude');
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-start-anyway-')));
  parent = await parentChat(t, await projectAt(t, scratch, 'shop'));
  [api, page, docs] = (await startedPlan(t, parent, THREE_PIECES)) as [
    SubChatRecord,
    SubChatRecord,
    SubChatRecord,
  ];
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

const startPath = (subChatId: string, parentId = parent.id) =>
  `/api/conversations/${parentId}/sub-chats/${subChatId}/start`;

describe('Start anyway', () => {
  it('starts a Held sub-chat with its task, from the parent and never as the user’s message', async () => {
    expect(await turnsOf(t, page.conversation_id)).toEqual([]);

    const response = await localClient(app)
      .send('post', startPath(page.conversation_id))
      .expect(200);

    const rows = (response.body as SubChatsResponse).subChats;
    expect(rows.map((row) => [row.title, row.status])).toEqual([
      ['Orders API', 'working'],
      ['Orders page', 'working'],
      ['Docs', 'held'],
    ]);
    const [started] = (await subChatsOf(t, parent.id)).filter(
      (piece) => piece.conversation_id === page.conversation_id,
    );
    expect(started?.started_at).not.toBeNull();
    expect(await askNow(t, started!.task_ask_id!)).toMatchObject({
      kind: 'task',
      from: { id: parent.id, title: PARENT_TITLE },
      body: 'Build the orders page.',
      state: 'waiting',
    });
    const [turn] = await turnsOf(t, page.conversation_id);
    expect(turn).toMatchObject({ source: 'chat', user_message_id: started!.task_ask_id });
  });

  it('starts it once however often it is pressed', async () => {
    await localClient(app).send('post', startPath(docs.conversation_id)).expect(200);
    await localClient(app).send('post', startPath(docs.conversation_id)).expect(200);
    await localClient(app).send('post', startPath(api.conversation_id)).expect(200);

    expect(await turnsOf(t, docs.conversation_id)).toHaveLength(1);
    expect(await turnsOf(t, api.conversation_id)).toHaveLength(1);
    const { rows } = await t.db.query(`SELECT 1 FROM chat_asks WHERE kind = 'task'`);
    expect(rows).toHaveLength(2);
  });

  it('refuses a chat that is not a sub-chat of that parent', async () => {
    const stranger = await emptyChat(t, 'Billing export');
    const refused = await localClient(app).send('post', startPath(stranger)).expect(409);
    expect(refused.body.error).toBe(NOT_THIS_CHATS_SUB_CHAT);
    await localClient(app).send('post', startPath(page.conversation_id, stranger)).expect(409);
    await localClient(app).send('post', startPath(page.conversation_id, randomUUID())).expect(404);
    await localClient(app).send('post', startPath('not-an-id')).expect(400);
    expect(await turnsOf(t, page.conversation_id)).toEqual([]);
  });
});
