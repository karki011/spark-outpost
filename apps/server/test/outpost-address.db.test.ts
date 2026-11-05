import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outpostDetailSchema, threadItems, type OutpostPost } from '@spark-outpost/contracts';
import { ownRequestText } from '../src/persistence/outpost-own-request.ts';
import { chatTurns } from './outpost-fixtures.ts';
import {
  gate,
  openRoom,
  readRoom,
  shown,
  startStack,
  type Room,
  type Stack,
} from './outposts-e2e-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const BOTH = 'Before Friday: @api list the order fields and @web name the page.';

let t: TestDb;
let stack: Stack;
let room: Room;
let held: ReturnType<typeof gate>;

beforeEach(async () => {
  t = await createTestDb();
  held = gate();
  stack = await startStack(t, { held: held.opened });
  room = await openRoom(stack);
});

afterEach(async () => {
  held.open();
  await stack.stop();
  await t.cleanup();
});

function path(rest = ''): string {
  return `/api/outposts/${room.outpostId}/posts${rest}`;
}

async function send(text: string, to?: string[], id = randomUUID()): Promise<OutpostPost[]> {
  const body = { id, text, ...(to ? { to } : {}) };
  const response = await stack.send('post', path(), body).expect(201);
  const posts = outpostDetailSchema.parse(response.body).posts;
  const first = posts.find((post) => post.id === id);
  if (!first) throw new Error('The post is not in the thread.');
  return first.batchId === null ? [first] : posts.filter((post) => post.batchId === first.batchId);
}

function reaches(postId: string, state: string): Promise<OutpostPost> {
  return eventually(async () => {
    const found = await shown(stack, room.outpostId, postId);
    return found.state === state ? found : null;
  });
}

const CANCEL_POLL_MS = 250;

function workerSeesTheCancel(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS * 3));
}

async function typedIn(chatId: string, postId: string): Promise<string | undefined> {
  const { rows } = await t.db.query<{ content: string }>(
    `SELECT content FROM messages WHERE conversation_id = $1 AND id = $2 AND role = 'user'`,
    [chatId, postId],
  );
  return rows[0]?.content;
}

describe('a message that addresses two chats', () => {
  it('starts a turn in each with the whole message and shows each answer under one message', async () => {
    const [toApi, toWeb, ...rest] = await send(BOTH, ['api', 'web']);
    expect(rest).toEqual([]);
    expect(toApi).toMatchObject({ kind: 'request', toHandle: 'api', body: BOTH, state: 'sent' });
    expect(toWeb).toMatchObject({ kind: 'request', toHandle: 'web', body: BOTH, state: 'sent' });

    await reaches(toApi!.id, 'working');
    await reaches(toWeb!.id, 'working');
    held.open();
    const fromApi = await reaches(toApi!.id, 'answered');
    const fromWeb = await reaches(toWeb!.id, 'answered');

    expect(fromApi.answer?.text).toContain('list the order fields');
    expect(fromWeb.answer?.text).toContain('name the page');
    expect(await typedIn(room.api, toApi!.id)).toBe(BOTH);
    expect(await typedIn(room.web, toWeb!.id)).toBe(BOTH);
    expect(await ownRequestText(t.db, toApi!.id)).toBe('list the order fields');
    expect(await ownRequestText(t.db, toWeb!.id)).toBe('name the page.');
    expect(await chatTurns(t.db, room.api)).toMatchObject([
      { source: 'outpost', status: 'succeeded', user_message_id: toApi!.id },
    ]);
    expect(await chatTurns(t.db, room.web)).toMatchObject([
      { source: 'outpost', status: 'succeeded', user_message_id: toWeb!.id },
    ]);

    const items = threadItems((await readRoom(stack, room.outpostId)).posts);
    const message = items.find((item) => item.kind === 'batch');
    expect(message?.kind === 'batch' && message.lines.map((line) => line.post.state)).toEqual([
      'answered',
      'answered',
    ]);
    expect(items.filter((item) => item.kind === 'request')).toEqual([]);
  });

  it('reads the handles from the text when the sender names no chats', async () => {
    const posts = await send(BOTH);
    expect(posts.map((post) => post.toHandle)).toEqual(['api', 'web']);
  });

  it('adds nothing when the same message is sent again', async () => {
    const id = randomUUID();
    const first = await send(BOTH, ['api', 'web'], id);
    const again = await send(BOTH, ['api', 'web'], id);

    expect(again.map((post) => post.id)).toEqual(first.map((post) => post.id));
    const requests = (await readRoom(stack, room.outpostId)).posts.filter(
      (post) => post.kind === 'request',
    );
    expect(requests).toHaveLength(2);
    await reaches(first[0]!.id, 'working');
    await reaches(first[1]!.id, 'working');
    expect(await chatTurns(t.db, room.api)).toHaveLength(1);
    expect(await chatTurns(t.db, room.web)).toHaveLength(1);
  });

  it('cancels one chat and lets the other answer', async () => {
    const [toApi, toWeb] = await send(BOTH, ['api', 'web']);
    await reaches(toApi!.id, 'working');
    await reaches(toWeb!.id, 'working');

    await stack.send('post', path(`/${toWeb!.id}/cancel`)).expect(200);
    expect(await shown(stack, room.outpostId, toApi!.id)).toMatchObject({ state: 'working' });
    await workerSeesTheCancel();
    held.open();

    await reaches(toWeb!.id, 'cancelled');
    await reaches(toApi!.id, 'answered');
    expect(await shown(stack, room.outpostId, toWeb!.id)).toMatchObject({
      state: 'cancelled',
      answer: null,
    });
  });

  it('cancels every chat when each is cancelled', async () => {
    const posts = await send(BOTH, ['api', 'web']);
    for (const post of posts) await reaches(post.id, 'working');

    for (const post of posts) await stack.send('post', path(`/${post.id}/cancel`)).expect(200);
    await workerSeesTheCancel();
    held.open();

    for (const post of posts) await reaches(post.id, 'cancelled');
    const turns = [...(await chatTurns(t.db, room.api)), ...(await chatTurns(t.db, room.web))];
    expect(turns.map((turn) => turn.status)).toEqual(['cancelled', 'cancelled']);
  });
});

describe('the chats the sender kept', () => {
  it('asks only those, and the other handle stays a mention', async () => {
    const posts = await send(BOTH, ['web']);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ toHandle: 'web', body: BOTH, batchId: null });
    await reaches(posts[0]!.id, 'working');
    expect(await chatTurns(t.db, room.api)).toEqual([]);
  });

  it('posts a note when nobody is kept', async () => {
    const [note] = await send(BOTH, []);

    expect(note).toMatchObject({ kind: 'note', body: BOTH, state: null, toHandle: null });
  });

  it('refuses a chat that is not here or not addressed, and stores nothing', async () => {
    const refused = async (text: string, to: string[]) => {
      const response = await stack.send('post', path(), { id: randomUUID(), text, to });
      return [response.status, (response.body as { error?: string }).error];
    };
    const before = (await readRoom(stack, room.outpostId)).posts.length;

    expect(await refused('@api and @docs sync up', ['api', 'docs'])).toEqual([
      400,
      '@docs is not in this outpost.',
    ]);
    expect(await refused('@api list the fields', ['api', 'web'])).toEqual([
      400,
      'The message does not address @web.',
    ]);
    expect((await readRoom(stack, room.outpostId)).posts).toHaveLength(before);
  });
});
