import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  getConversationDetail,
  listConversations,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import {
  addMemberChat,
  createOutpostRow,
  deliverRequest,
  finishRun,
  postRunId,
} from './outpost-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let api: string;

const target: ResolveTarget = async () => ({ provider: 'fake' });

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t, 'Orders launch');
  api = await addMemberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

describe('a chat summary', () => {
  it('names the outpost and handle of a member chat, in the detail and in the list', async () => {
    const outpost = { id: outpostId, name: 'Orders launch', handle: 'api' };
    await sendUserMessage(t.db, api, { id: randomUUID(), content: 'hello' }, { provider: 'fake' });

    expect((await getConversationDetail(t.db, api))?.conversation.outpost).toEqual(outpost);
    const listed = (await listConversations(t.db, t.workspaceId)).find((chat) => chat.id === api);
    expect(listed?.outpost).toEqual(outpost);
  });

  it('has no outpost for a chat that is not a member', async () => {
    const plain = randomUUID();
    await createConversation(t.db, t.workspaceId, plain);
    await sendUserMessage(
      t.db,
      plain,
      { id: randomUUID(), content: 'hello' },
      { provider: 'fake' },
    );

    const detail = await getConversationDetail(t.db, plain);
    expect(detail?.conversation).not.toHaveProperty('outpost');
    const listed = (await listConversations(t.db, t.workspaceId)).find((chat) => chat.id === plain);
    expect(listed).not.toHaveProperty('outpost');
  });

  it('loses it when the chat leaves the outpost', async () => {
    await t.db.query('DELETE FROM outpost_members WHERE conversation_id = $1', [api]);

    expect((await getConversationDetail(t.db, api))?.conversation).not.toHaveProperty('outpost');
  });
});

describe('the runs of a member chat', () => {
  it('say which request started a run and that the user wrote it', async () => {
    const postId = await deliverRequest(t.db, {
      outpostId,
      toConversationId: api,
      toHandle: 'api',
      body: 'Add the orders endpoint.',
    });
    await drainQueue(t.db, api, target);

    const detail = await getConversationDetail(t.db, api);

    expect(detail?.runs).toHaveLength(1);
    expect(detail?.runs[0]?.id).toBe(await postRunId(t.db, postId));
    expect(detail?.runs[0]?.outpost).toEqual({
      postId,
      outpostId,
      outpostName: 'Orders launch',
      fromHandle: null,
      fromUser: true,
      fromSpark: false,
      userStarted: false,
      agentStarted: false,
    });
  });

  it('carry the sender’s handle for a request the user did not write', async () => {
    const postId = await deliverRequest(t.db, {
      outpostId,
      toConversationId: api,
      toHandle: 'api',
      body: 'Which shape?',
      fromUser: false,
    });
    await t.db.query(`UPDATE outpost_posts SET from_handle = 'fe' WHERE id = $1`, [postId]);
    await drainQueue(t.db, api, target);

    const detail = await getConversationDetail(t.db, api);

    expect(detail?.runs[0]?.outpost).toMatchObject({ fromHandle: 'fe', fromUser: false });
  });

  it('have no outpost for a message typed in the chat, or the answer to a Needs you', async () => {
    const postId = await deliverRequest(t.db, {
      outpostId,
      toConversationId: api,
      toHandle: 'api',
      body: 'Which shape?',
    });
    await drainQueue(t.db, api, target);
    await finishRun(t.db, (await postRunId(t.db, postId))!, 'succeeded', 'Needs you: v1 or v2?');
    await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'v2', source: 'ui' },
      { provider: 'fake' },
    );

    const detail = await getConversationDetail(t.db, api);

    expect(detail?.runs).toHaveLength(2);
    expect(detail?.runs[0]).toHaveProperty('outpost');
    expect(detail?.runs[1]).not.toHaveProperty('outpost');
  });

  it('drop the outpost once the outpost is deleted', async () => {
    await deliverRequest(t.db, {
      outpostId,
      toConversationId: api,
      toHandle: 'api',
      body: 'Which shape?',
    });
    await drainQueue(t.db, api, target);
    await t.db.query('DELETE FROM outposts WHERE id = $1', [outpostId]);

    const detail = await getConversationDetail(t.db, api);

    expect(detail?.runs[0]).not.toHaveProperty('outpost');
    expect(detail?.conversation).not.toHaveProperty('outpost');
  });
});
