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
import {
  ALL_NOT_AVAILABLE,
  GUESTS_NOT_AVAILABLE,
  ONLY_USER_POSTS,
} from '../src/outposts/post-rules.ts';
import { accept, newChat, outpostEvents } from './outpost-store-support.ts';
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
  await openOutpost(deps, {
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
  it('adds each member with one handshake line and tells the app', async () => {
    expect(await bodies()).toEqual([
      '@fe joined.',
      '@api joined. @fe and @api can now ask each other.',
    ]);
    const notices = await listPosts(t.db, outpostId);
    expect(notices.every(({ post: line }) => line.kind === 'notice' && !line.fromUser)).toBe(true);
    await notified(1);
  });

  it('returns the first outpost and adds nothing when the same id is opened again', async () => {
    const again = await openOutpost(deps, {
      id: outpostId,
      name: 'Renamed',
      members: [{ conversationId: await newChat(t), handle: 'docs' }],
    });

    expect(again.created).toBe(false);
    expect(again.outpost.name).toBe('Orders launch');
    expect(again.outpost.members.map((member) => member.handle)).toEqual(['fe', 'api']);
    expect(await bodies()).toHaveLength(2);
  });

  it('creates nothing when one member cannot join', async () => {
    const id = randomUUID();
    const refused = await refusal(
      openOutpost(deps, {
        id,
        name: 'Second',
        members: [
          { conversationId: await newChat(t), handle: 'docs' },
          { conversationId: fe, handle: 'web' },
        ],
      }),
    );

    expect(refused.status).toBe(409);
    expect(await getOutpost(t.db, t.workspaceId, id)).toBeNull();
  });

  it('refuses two members with one handle, with the sentence for the handle', async () => {
    const refused = await refusal(
      openOutpost(deps, {
        id: randomUUID(),
        name: 'Second',
        members: [
          { conversationId: await newChat(t), handle: 'docs' },
          { conversationId: await newChat(t), handle: 'docs' },
        ],
      }),
    );

    expect(refused).toEqual({ status: 400, message: '@docs is already used in this outpost.' });
  });
});

describe('joining and leaving', () => {
  it('adds a later member with a line that names everyone', async () => {
    const docs = await newChat(t);
    const member = await joinOutpost(deps, { outpostId, conversationId: docs, handle: 'docs' });

    expect(member).toMatchObject({ conversationId: docs, handle: 'docs', position: 3 });
    expect((await bodies()).at(-1)).toBe(
      '@docs joined. @fe, @api and @docs can now ask each other.',
    );
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
      guest: false,
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
    await openOutpost(deps, { id: other, name: 'Second', members: [] });
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

  it('refuses @all, a guest and an agent author for now, and stores nothing', async () => {
    expect(await refusal(post('@all rebase on main'))).toEqual({
      status: 400,
      message: ALL_NOT_AVAILABLE,
    });
    expect(
      await refusal(
        postToOutpost(deps, {
          outpostId,
          author: { kind: 'user' },
          id: randomUUID(),
          text: '@docs look at this',
          guestConversationId: await newChat(t),
        }),
      ),
    ).toEqual({ status: 400, message: GUESTS_NOT_AVAILABLE });
    expect(
      await refusal(
        postToOutpost(deps, {
          outpostId,
          author: {
            kind: 'chat',
            conversationId: fe,
            handle: 'fe',
            runId: randomUUID(),
            startedByRequest: false,
          },
          text: '@api what is the shape?',
        }),
      ),
    ).toEqual({ status: 400, message: ONLY_USER_POSTS });
    expect(await bodies()).toHaveLength(2);
  });

  it('refuses an unknown outpost', async () => {
    const refused = await refusal(
      postToOutpost(deps, { outpostId: randomUUID(), author: { kind: 'user' }, text: 'Hello' }),
    );
    expect(refused.status).toBe(404);
  });
});
