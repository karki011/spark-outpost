import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPost, listPosts } from '../src/persistence/outpost-posts.ts';
import { getOutpost, OutpostError } from '../src/persistence/outposts.ts';
import {
  joinOutpost,
  leaveOutpost,
  openOutpost,
  POST_ID_IN_USE,
  postToOutpost,
  type PostServiceDeps,
} from '../src/outposts/post-service.ts';
import { startOutpost } from '../src/outposts/start-outpost.ts';
import {
  AUTHOR_NOT_MEMBER,
  OUTPOST_PAUSED,
  REQUEST_STARTED_TURN,
} from '../src/outposts/post-rules.ts';
import type { RequestAuthor } from '../src/outposts/ports.ts';
import { recordObservation } from '../src/persistence/observations.ts';
import { setPaused } from '../src/persistence/outposts.ts';
import { accept, chatWithTurn, newChat, outpostEvents } from './outpost-store-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let deps: PostServiceDeps;
let outpostId: string;
let fe: string;
let api: string;
let events: Awaited<ReturnType<typeof outpostEvents>>;

beforeEach(async () => {
  t = await createTestDb();
  deps = { db: t.db, workspaceId: t.workspaceId };
  events = await outpostEvents();
  [fe, api] = [await newChat(t), await newChat(t)];
  outpostId = randomUUID();
  await startOutpost(deps, {
    id: outpostId,
    name: 'Orders launch',
    members: [
      { conversationId: fe, handle: 'fe' },
      { conversationId: api, handle: 'api' },
    ],
  });
});

afterEach(async () => {
  await events.close();
  await t.cleanup();
});

async function refusal(work: Promise<unknown>): Promise<{ status: number; message: string }> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(OutpostError);
  const { status, message } = error as OutpostError;
  return { status, message };
}

async function bodies(): Promise<string[]> {
  return (await listPosts(t.db, outpostId)).map((found) => found.post.body);
}

function post(text: string, id = randomUUID()) {
  return postToOutpost(deps, { outpostId, author: { kind: 'user' }, id, text });
}

async function notified(count: number): Promise<void> {
  await eventually(async () => events.seen.filter((id) => id === outpostId).length >= count);
}

describe('opening an outpost', () => {
  it('adds each member with one introduction line and tells the app', async () => {
    expect(await bodies()).toEqual(['@fe joined', '@api joined']);
    const notices = await listPosts(t.db, outpostId);
    expect(notices.every(({ post: line }) => line.kind === 'notice' && !line.fromUser)).toBe(true);
    expect(notices.map(({ post: line }) => [line.fromConversationId, line.fromHandle])).toEqual([
      [fe, 'fe'],
      [api, 'api'],
    ]);
    await notified(1);
  });

  it('keeps the first name when the same id is opened again', async () => {
    const again = await openOutpost(deps, { id: outpostId, name: 'Renamed' });

    expect(again.created).toBe(false);
    expect((await getOutpost(t.db, t.workspaceId, outpostId))?.name).toBe('Orders launch');
    expect(await bodies()).toHaveLength(2);
  });
});

describe('joining and leaving', () => {
  it('adds a later member with its own introduction line', async () => {
    const docs = await newChat(t);
    const member = await joinOutpost(deps, { outpostId, conversationId: docs, handle: 'docs' });

    expect(member).toMatchObject({ conversationId: docs, handle: 'docs', position: 3 });
    expect((await bodies()).at(-1)).toBe('@docs joined');
    await notified(2);
  });

  it('renames a member that joins again with another handle and writes no second line', async () => {
    const renamed = await joinOutpost(deps, { outpostId, conversationId: api, handle: 'backend' });
    const same = await joinOutpost(deps, { outpostId, conversationId: api, handle: 'backend' });

    expect(renamed.handle).toBe('backend');
    expect(same).toEqual(renamed);
    expect(await bodies()).toHaveLength(2);
  });

  it('refuses a reserved, malformed or taken handle with its sentence and adds nothing', async () => {
    const docs = await newChat(t);
    const cases: [string, string][] = [
      ['all', '@all is reserved. Choose another handle.'],
      ['Docs', 'A handle starts with a lower-case letter.'],
      ['api', '@api is already used in this outpost.'],
    ];

    for (const [handle, message] of cases) {
      expect(await refusal(joinOutpost(deps, { outpostId, conversationId: docs, handle }))).toEqual(
        {
          status: 400,
          message,
        },
      );
    }
    expect(
      (await refusal(joinOutpost(deps, { outpostId, conversationId: fe, handle: 'api' }))).status,
    ).toBe(400);
    expect(await bodies()).toHaveLength(2);
  });

  it('refuses an unknown outpost', async () => {
    const refused = await refusal(
      joinOutpost(deps, { outpostId: randomUUID(), conversationId: fe, handle: 'fe' }),
    );
    expect(refused.status).toBe(404);
  });

  it('closes the requests still waiting for a member that leaves', async () => {
    const [unsent] = await post('@api first');
    const [queued] = await post('@api second');
    await accept(t, queued!.id);

    expect(await leaveOutpost(deps, { outpostId, conversationId: api })).toBe(true);
    expect(await leaveOutpost(deps, { outpostId, conversationId: api })).toBe(false);

    for (const waiting of [unsent, queued]) {
      expect((await getPost(t.db, waiting!.id))?.post).toMatchObject({
        closedState: 'rejected',
        closedReason: 'not_member',
        toHandle: 'api',
      });
    }
    const queue = await t.db.query('SELECT 1 FROM chat_queue WHERE conversation_id = $1', [api]);
    expect(queue.rowCount).toBe(0);
  });
});

describe('posting to an outpost', () => {
  it('stores text that starts with a member handle as a request from the user', async () => {
    const id = randomUUID();
    const [stored] = await post('@api  what is the response shape?', id);

    expect(stored).toMatchObject({
      id,
      kind: 'request',
      body: 'what is the response shape?',
      fromUser: true,
      fromConversationId: null,
      toHandle: 'api',
      toConversationId: api,
      taskId: null,
    });
    await notified(2);
  });

  it('stores any other text as a note addressed to nobody', async () => {
    const [note] = await post('Shipping Friday.');
    const [unknown] = await post('@docs can you look?');

    expect(note).toMatchObject({ kind: 'note', body: 'Shipping Friday.', toHandle: null });
    expect(unknown).toMatchObject({ kind: 'note', body: '@docs can you look?' });
  });

  it('returns the first post when the same id is posted again', async () => {
    const id = randomUUID();
    const [first] = await post('@api first words', id);
    const [again] = await post('@fe other words', id);

    expect(again).toEqual(first);
    expect(await bodies()).toHaveLength(3);
  });

  it('refuses an id that another outpost already used', async () => {
    const other = randomUUID();
    await openOutpost(deps, { id: other, name: 'Second' });
    const id = randomUUID();
    await post('A note.', id);

    expect(
      await refusal(
        postToOutpost(deps, { outpostId: other, author: { kind: 'user' }, id, text: 'A note.' }),
      ),
    ).toEqual({ status: 409, message: POST_ID_IN_USE });
  });

  it('redacts a secret before the text is stored', async () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const [request] = await post(`@api use ${secret} for the call`);
    const [note] = await post(`The key is ${secret}`);

    const stored = await t.db.query<{ body: string }>(
      'SELECT body FROM outpost_posts WHERE id = ANY($1::uuid[])',
      [[request!.id, note!.id]],
    );
    expect(stored.rows).toHaveLength(2);
    for (const row of stored.rows) {
      expect(row.body).not.toContain(secret);
      expect(row.body).toContain('[redacted');
    }
  });

  it('stores one request per chat the message addresses, as typed and under one batch', async () => {
    const id = randomUUID();
    const text = 'Sync up: @api returns the shape and @fe draws it. Thanks @api.';
    const stored = await post(text, id);

    expect(stored).toHaveLength(2);
    expect(stored.map((each) => [each.id === id, each.toHandle, each.toConversationId])).toEqual([
      [true, 'api', api],
      [false, 'fe', fe],
    ]);
    for (const each of stored) {
      expect(each).toMatchObject({ kind: 'request', body: text, fromUser: true });
    }
    expect(stored[0]!.batchId).not.toBeNull();
    expect(stored[1]!.batchId).toBe(stored[0]!.batchId);
  });

  it('stores a handle in the middle of a sentence as a request with the whole text', async () => {
    const [stored, ...rest] = await post('could @api list the order fields?');
    expect(rest).toEqual([]);
    expect(stored).toMatchObject({
      kind: 'request',
      toHandle: 'api',
      body: 'could @api list the order fields?',
      batchId: null,
    });
  });

  it('sends @all to every member', async () => {
    const stored = await post('@all rebase on main');
    expect(stored.map((each) => each.toHandle)).toEqual(['fe', 'api']);
    expect(new Set(stored.map((each) => each.batchId)).size).toBe(1);
  });

  it('asks only the chats the sender kept, and posts a note when none is kept', async () => {
    const text = '@fe build it with what @api returns';
    const kept = (to: string[]) =>
      postToOutpost(deps, { outpostId, author: { kind: 'user' }, id: randomUUID(), text, to });

    const one = await kept(['FE']);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      toHandle: 'fe',
      body: 'build it with what @api returns',
      batchId: null,
    });

    const none = await kept([]);
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ kind: 'note', body: text, toHandle: null });
  });

  it('refuses a kept chat that is not a member or that the message does not address', async () => {
    const send = (text: string, to: string[]) =>
      refusal(postToOutpost(deps, { outpostId, author: { kind: 'user' }, text, to }));

    expect(await send('@api and @docs sync up', ['api', 'docs'])).toEqual({
      status: 400,
      message: '@docs is not in this outpost.',
    });
    expect(await send('@api list the fields', ['api', 'fe'])).toEqual({
      status: 400,
      message: 'The message does not address @fe.',
    });
    expect(await bodies()).toHaveLength(2);
  });

  it('stores nothing more when a message to several chats is posted again', async () => {
    const id = randomUUID();
    const [first] = await post('@api and @fe sync up', id);
    const again = await post('@api and @fe sync up', id);

    expect(again).toEqual([first]);
    expect(await bodies()).toHaveLength(4);
  });

  it('refuses an unknown outpost', async () => {
    const refused = await refusal(
      postToOutpost(deps, { outpostId: randomUUID(), author: { kind: 'user' }, text: 'Hello' }),
    );
    expect(refused.status).toBe(404);
  });
});

describe('a post written by a member chat', () => {
  let asker: { conversationId: string; runId: string };
  let author: RequestAuthor;

  beforeEach(async () => {
    asker = await chatWithTurn(t);
    await joinOutpost(deps, { outpostId, conversationId: asker.conversationId, handle: 'lead' });
    author = {
      kind: 'chat',
      conversationId: asker.conversationId,
      handle: 'lead',
      runId: asker.runId,
      startedByRequest: false,
    };
  });

  function ask(text = '@api what is the response shape?', extra: object = {}) {
    return postToOutpost(deps, { outpostId, author, text, ...extra });
  }

  it('stores a request from the chat and its turn, never from the user, with what the turn had read', async () => {
    await recordObservation(t.db, asker.runId, { source: 'web_page', label: 'example.com' });

    const [post] = await ask('@api what is the response shape?', { waits: true });

    expect(post).toMatchObject({
      kind: 'request',
      body: 'what is the response shape?',
      fromUser: false,
      userStarted: false,
      fromConversationId: asker.conversationId,
      fromHandle: 'lead',
      fromRunId: asker.runId,
      toHandle: 'api',
      toConversationId: api,
      waits: true,
      observed: [{ source: 'web_page', label: 'example.com' }],
      afterPostId: null,
    });
    expect(post?.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps direct-target agent requests agent-authored and applies the same sending restrictions', async () => {
    const [stored] = await ask('where are we', { toConversationId: api });
    expect(stored).toMatchObject({
      kind: 'request',
      body: 'where are we',
      fromUser: false,
      fromConversationId: asker.conversationId,
      toConversationId: api,
    });
    author = { ...author, startedByRequest: true } as RequestAuthor;
    expect(await refusal(ask('follow up', { toConversationId: api }))).toEqual({
      status: 400,
      message: REQUEST_STARTED_TURN,
    });
    author = { ...author, startedByRequest: false } as RequestAuthor;
    await setPaused(t.db, t.workspaceId, outpostId, true);
    expect(await refusal(ask('follow up', { toConversationId: api }))).toEqual({
      status: 400,
      message: OUTPOST_PAUSED,
    });
  });

  it('stores the same request from the same turn once, and a different one again', async () => {
    const [first] = await ask();
    const [again] = await ask();
    const [other] = await ask('@api and the error shape?');
    const [toFe] = await ask('@fe what is the response shape?');

    expect(again?.id).toBe(first?.id);
    expect(new Set([first?.id, other?.id, toFe?.id]).size).toBe(3);
    expect(first).toMatchObject({ waits: false, observed: [] });
  });

  it('never reads a handle in the middle of what a chat wrote as an address', async () => {
    const stored = await ask('The shape came from @api and @fe, thanks.');

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'note', toHandle: null, batchId: null });
  });

  it('stores a note from the chat without a hash or labels', async () => {
    const [note] = await ask('The endpoint is live.');

    expect(note).toMatchObject({
      kind: 'note',
      fromUser: false,
      fromConversationId: asker.conversationId,
      fromHandle: 'lead',
      fromRunId: asker.runId,
      requestHash: null,
      observed: [],
    });
  });

  it('refuses a request from a turn another chat started, while paused and from a chat that left', async () => {
    author = { ...author, startedByRequest: true } as RequestAuthor;
    expect(await refusal(ask())).toEqual({ status: 400, message: REQUEST_STARTED_TURN });

    author = { ...author, startedByRequest: false } as RequestAuthor;
    await setPaused(t.db, t.workspaceId, outpostId, true);
    expect(await refusal(ask())).toEqual({ status: 400, message: OUTPOST_PAUSED });
    await setPaused(t.db, t.workspaceId, outpostId, false);

    await leaveOutpost(deps, { outpostId, conversationId: asker.conversationId });
    expect(await refusal(ask())).toEqual({ status: 400, message: AUTHOR_NOT_MEMBER });
    expect(
      (await listPosts(t.db, outpostId)).filter(({ post }) => post.kind === 'request'),
    ).toEqual([]);
  });

  it('refuses a post id another author already used', async () => {
    const id = randomUUID();
    await postToOutpost(deps, { outpostId, author: { kind: 'user' }, id, text: '@api hello' });

    expect(await refusal(ask('@api hello', { id }))).toEqual({
      status: 409,
      message: POST_ID_IN_USE,
    });
  });
});
