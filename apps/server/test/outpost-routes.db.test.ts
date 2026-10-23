import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OUTPOST_INSTRUCTIONS_MAX,
  outpostDetailSchema,
  outpostSchema,
  type OutpostDetail,
  type OutpostPost,
} from '@spark-outpost/contracts';
import {
  CANCEL_UNAVAILABLE,
  NOT_A_MEMBER,
  ONLY_REQUESTS_CANCEL,
  outpostErrorStatus,
  outpostRoutes,
  POST_NOT_FOUND,
  REQUEST_FINISHED,
} from '../src/api/outpost-routes.ts';
import { statusForError } from '../src/api/routes.ts';
import { closePost } from '../src/persistence/outpost-posts.ts';
import { OUTPOST_NOT_FOUND } from '../src/persistence/outposts.ts';
import { GUESTS_NOT_AVAILABLE } from '../src/outposts/post-rules.ts';
import type { TaskRef, TaskView } from '../src/outposts/ports.ts';
import { fakePeerAgent, type FakePeerAgent } from './fake-peer-agent.ts';
import {
  accept,
  carry,
  chatWithTurn,
  newChat,
  outpostEvents,
  reply,
  setRun,
} from './outpost-store-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let app: express.Express;
let peer: FakePeerAgent;
let drained: string[];
let cancelOutcome: (task: TaskRef) => Promise<TaskView>;
let fe: string;
let api: { conversationId: string; runId: string };
let outpostId: string;

async function closeAsCancelled(task: TaskRef): Promise<TaskView> {
  await t.db.query(
    `UPDATE outpost_posts SET closed_state = 'cancelled', closed_at = now() WHERE task_id = $1`,
    [task.taskId],
  );
  return { taskId: task.taskId, state: 'cancelled', reason: null };
}

beforeEach(async () => {
  t = await createTestDb();
  drained = [];
  cancelOutcome = closeAsCancelled;
  peer = fakePeerAgent({ cancel: (task) => cancelOutcome(task) });
  app = express();
  app.use(express.json());
  app.use(
    '/api',
    outpostRoutes({
      db: t.db,
      workspaceId: t.workspaceId,
      peer,
      drain: async (conversationId) => {
        drained.push(conversationId);
        if (conversationId === fe) throw new Error('No provider is connected.');
      },
    }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, message } = outpostErrorStatus(error) ?? statusForError(error);
    res.status(status).json({ error: message });
  });
  fe = await newChat(t);
  api = await chatWithTurn(t);
  await setRun(t, api.runId, 'succeeded');
  outpostId = randomUUID();
  const created = await send('post', '/api/outposts', {
    id: outpostId,
    name: 'Orders launch',
    members: [
      { conversationId: fe, handle: 'fe' },
      { conversationId: api.conversationId, handle: 'api' },
    ],
  });
  expect(created.status).toBe(201);
});

afterEach(async () => {
  await t.cleanup();
});

function send(method: 'post' | 'put' | 'patch' | 'delete', path: string, body: object = {}) {
  return request(app)[method](path).send(body);
}

async function detail(): Promise<OutpostDetail> {
  const response = await request(app).get(`/api/outposts/${outpostId}`);
  expect(response.status).toBe(200);
  return outpostDetailSchema.parse(response.body);
}

async function ask(text = '@api what is the response shape?'): Promise<OutpostPost> {
  const id = randomUUID();
  const response = await send('post', `/api/outposts/${outpostId}/posts`, { id, text });
  expect(response.status).toBe(201);
  return outpostDetailSchema.parse(response.body).posts.find((post) => post.id === id)!;
}

async function receivingRun(postId: string, status: Parameters<typeof setRun>[2]) {
  const turn = await chatWithTurn(t);
  await t.db.query('UPDATE runs SET conversation_id = $2 WHERE id = $1', [
    turn.runId,
    api.conversationId,
  ]);
  await carry(t, postId, turn.runId);
  await setRun(t, turn.runId, status);
  return turn.runId;
}

const cancel = (postId: string, outpost = outpostId) =>
  send('post', `/api/outposts/${outpost}/posts/${postId}/cancel`);

async function postOf(postId: string): Promise<OutpostPost> {
  return (await detail()).posts.find((post) => post.id === postId)!;
}

describe('outposts', () => {
  it('saves trimmed outpost instructions, clears them, and refuses ones over the limit', async () => {
    expect((await detail()).outpost.instructions).toBe('');

    const saved = await send('put', `/api/outposts/${outpostId}/instructions`, {
      instructions: '  Branch from main.  ',
    });
    expect(saved.status).toBe(200);
    expect(outpostDetailSchema.parse(saved.body).outpost.instructions).toBe('Branch from main.');

    const tooLong = await send('put', `/api/outposts/${outpostId}/instructions`, {
      instructions: 'x'.repeat(OUTPOST_INSTRUCTIONS_MAX + 1),
    });
    expect(tooLong.status).toBe(400);
    await send('put', `/api/outposts/${outpostId}/instructions`, { instructions: '' });
    expect((await detail()).outpost.instructions).toBe('');
    const missing = await send('put', `/api/outposts/${randomUUID()}/instructions`, {
      instructions: 'x',
    });
    expect(missing.status).toBe(404);
  });

  it('creates an outpost with members and introduction lines, and lists it', async () => {
    const opened = await detail();

    expect(opened.outpost).toMatchObject({ id: outpostId, name: 'Orders launch', needsYou: 0 });
    expect(opened.outpost.members.map((member) => member.handle)).toEqual(['fe', 'api']);
    expect(opened.posts.map((post) => [post.kind, post.body])).toEqual([
      ['notice', '@fe joined'],
      ['notice', '@api joined'],
    ]);
    const listed = await request(app).get('/api/outposts');
    expect(outpostSchema.array().parse(listed.body)).toEqual([opened.outpost]);
  });

  it('answers a repeated create with the first outpost', async () => {
    const again = await send('post', '/api/outposts', {
      id: outpostId,
      name: 'Another',
      members: [],
    });

    expect(again.status).toBe(200);
    expect(outpostDetailSchema.parse(again.body).outpost.name).toBe('Orders launch');
  });

  it('refuses a malformed create, patch and post', async () => {
    const bad = [
      await send('post', '/api/outposts', { id: 'nope', name: 'X', members: [] }),
      await send('post', '/api/outposts', { id: randomUUID(), name: ' ', members: [] }),
      await send('post', '/api/outposts', {
        id: randomUUID(),
        name: 'X',
        members: [{ conversationId: fe, handle: 'Not Valid' }],
      }),
      await send('patch', `/api/outposts/${outpostId}`, {}),
      await send('patch', `/api/outposts/${outpostId}`, { name: 'x'.repeat(61) }),
      await send('post', `/api/outposts/${outpostId}/posts`, { id: randomUUID(), text: '  ' }),
      await send('post', `/api/outposts/${outpostId}/posts`, { text: 'No id' }),
      await request(app).get('/api/outposts/not-a-uuid'),
    ];

    expect(bad.map((response) => response.status)).toEqual(bad.map(() => 400));
  });

  it('answers 404 for an outpost that does not exist on every route', async () => {
    const missing = `/api/outposts/${randomUUID()}`;
    const responses = [
      await request(app).get(missing),
      await send('patch', missing, { name: 'New' }),
      await send('delete', missing),
      await send('put', `${missing}/members/${fe}`, { handle: 'fe' }),
      await send('delete', `${missing}/members/${fe}`),
      await send('post', `${missing}/posts`, { id: randomUUID(), text: 'Hello' }),
      await send('post', `${missing}/posts/${randomUUID()}/cancel`),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: OUTPOST_NOT_FOUND });
    }
  });

  it('renames an outpost and tells the app', async () => {
    const events = await outpostEvents();
    try {
      const renamed = await send('patch', `/api/outposts/${outpostId}`, { name: ' Checkout ' });

      expect(outpostDetailSchema.parse(renamed.body).outpost.name).toBe('Checkout');
      await eventually(async () => events.seen.includes(outpostId));
    } finally {
      await events.close();
    }
  });

  it('pauses, shows waiting requests as paused, and on resume drains every member chat', async () => {
    const paused = await send('patch', `/api/outposts/${outpostId}`, { paused: true });
    expect(outpostDetailSchema.parse(paused.body).outpost.pausedAt).not.toBeNull();
    const asked = await ask();
    expect(asked).toMatchObject({ state: 'sent', reason: 'Paused' });
    expect(drained).toEqual([]);

    const resumed = await send('patch', `/api/outposts/${outpostId}`, { paused: false });

    expect(resumed.status).toBe(200);
    expect(outpostDetailSchema.parse(resumed.body).outpost.pausedAt).toBeNull();
    expect([...drained].sort()).toEqual([fe, api.conversationId].sort());
    expect(await postOf(asked.id)).toMatchObject({ state: 'sent', reason: 'Not sent yet' });

    await send('patch', `/api/outposts/${outpostId}`, { paused: false });
    expect(drained).toHaveLength(2);
  });

  it('deletes an outpost with its thread and keeps the chats', async () => {
    await ask();

    expect((await send('delete', `/api/outposts/${outpostId}`)).status).toBe(204);

    expect((await request(app).get(`/api/outposts/${outpostId}`)).status).toBe(404);
    expect((await request(app).get('/api/outposts')).body).toEqual([]);
    const chats = await t.db.query('SELECT 1 FROM conversations WHERE id = ANY($1::uuid[])', [
      [fe, api.conversationId],
    ]);
    expect(chats.rowCount).toBe(2);
  });
});

describe('members', () => {
  it('adds a chat with an introduction line, renames it, and removes it', async () => {
    const docs = await newChat(t);
    const member = `/api/outposts/${outpostId}/members/${docs}`;

    const added = outpostDetailSchema.parse((await send('put', member, { handle: 'docs' })).body);
    expect(added.outpost.members.map((entry) => entry.handle)).toEqual(['fe', 'api', 'docs']);
    expect(added.posts.at(-1)).toMatchObject({
      body: '@docs joined',
      intro: { conversationId: docs, task: null },
    });

    const renamed = outpostDetailSchema.parse(
      (await send('put', member, { handle: 'guide' })).body,
    );
    expect(renamed.outpost.members.at(-1)?.handle).toBe('guide');
    expect(renamed.posts).toHaveLength(3);

    const removed = outpostDetailSchema.parse((await send('delete', member)).body);
    expect(removed.outpost.members.map((entry) => entry.handle)).toEqual(['fe', 'api']);
    expect(await send('delete', member)).toMatchObject({
      status: 404,
      body: { error: NOT_A_MEMBER },
    });
  });

  it('refuses a bad handle with its sentence, a chat in another outpost and an unknown chat', async () => {
    const docs = await newChat(t);
    const member = `/api/outposts/${outpostId}/members/${docs}`;

    expect(await send('put', member, { handle: 'all' })).toMatchObject({
      status: 400,
      body: { error: '@all is reserved. Choose another handle.' },
    });
    expect(await send('put', member, { handle: 'api' })).toMatchObject({
      status: 400,
      body: { error: '@api is already used in this outpost.' },
    });
    expect((await send('put', member, {})).status).toBe(400);
    expect(
      (await send('put', `/api/outposts/${outpostId}/members/nope`, { handle: 'x1' })).status,
    ).toBe(400);

    const other = randomUUID();
    await send('post', '/api/outposts', { id: other, name: 'Second', members: [] });
    expect(
      (await send('put', `/api/outposts/${other}/members/${fe}`, { handle: 'web' })).status,
    ).toBe(409);
    expect(
      (await send('put', `/api/outposts/${outpostId}/members/${randomUUID()}`, { handle: 'ghost' }))
        .status,
    ).toBe(404);
  });

  it('marks the requests still waiting for a removed member as not delivered', async () => {
    const asked = await ask();

    await send('delete', `/api/outposts/${outpostId}/members/${api.conversationId}`);

    expect(await postOf(asked.id)).toMatchObject({
      state: 'failed',
      reason: 'Not delivered: no longer a member',
      toHandle: 'api',
    });
  });
});

describe('posts', () => {
  it('posts a request and a note, and repeats neither', async () => {
    const id = randomUUID();
    const body = { id, text: '@api what is the response shape?' };
    await send('post', `/api/outposts/${outpostId}/posts`, body);
    const again = await send('post', `/api/outposts/${outpostId}/posts`, body);
    await ask('Shipping Friday.');

    expect(again.status).toBe(201);
    const posts = (await detail()).posts.filter((post) => post.kind !== 'notice');
    expect(posts.map((post) => [post.kind, post.body, post.state, post.reason])).toEqual([
      ['request', 'what is the response shape?', 'sent', 'Not sent yet'],
      ['note', 'Shipping Friday.', null, null],
    ]);
    expect(posts[0]).toMatchObject({ id, fromUser: true, toHandle: 'api', answer: null });
  });

  it('refuses a guest for now with a sentence', async () => {
    const guest = await send('post', `/api/outposts/${outpostId}/posts`, {
      id: randomUUID(),
      text: '@docs look',
      guestConversationId: await newChat(t),
    });

    expect(guest).toMatchObject({ status: 400, body: { error: GUESTS_NOT_AVAILABLE } });
  });

  it('threads the answer under an answered request and counts a Needs you', async () => {
    const answered = await ask();
    const needs = await ask('@api REST or GraphQL?');
    await reply(t, await receivingRun(answered.id, 'succeeded'), 'A list of orders.');
    await reply(t, await receivingRun(needs.id, 'succeeded'), 'Needs you: REST or GraphQL?');

    const opened = await detail();

    expect(opened.posts.find((post) => post.id === answered.id)).toMatchObject({
      state: 'answered',
      answer: { text: 'A list of orders.', branch: null, changes: [], pullRequests: [] },
    });
    expect(opened.posts.find((post) => post.id === needs.id)).toMatchObject({
      state: 'needs_you',
      reason: 'REST or GraphQL?',
    });
    expect(opened.outpost.needsYou).toBe(1);
    const listed = await request(app).get('/api/outposts');
    expect(listed.body[0].needsYou).toBe(1);
  });
});

describe('cancelling a request', () => {
  it('closes a request nothing has accepted without calling the receiving chat', async () => {
    const asked = await ask();

    const response = await cancel(asked.id);

    expect(response.status).toBe(200);
    expect(await postOf(asked.id)).toMatchObject({ state: 'cancelled', reason: null });
    expect(peer.cancelled).toEqual([]);
  });

  it('cancels a queued request through the receiving chat', async () => {
    const asked = await ask();
    const taskId = await accept(t, asked.id);

    expect((await cancel(asked.id)).status).toBe(200);

    expect(peer.cancelled).toEqual([{ taskId, conversationId: api.conversationId }]);
    expect((await postOf(asked.id)).state).toBe('cancelled');
  });

  it('cancels a working request and one that needs the user through the receiving chat', async () => {
    const working = await ask();
    const waiting = await ask('@api and the errors?');
    await receivingRun(working.id, 'running');
    await receivingRun(waiting.id, 'awaiting_approval');
    cancelOutcome = async (task) => ({ taskId: task.taskId, state: 'working', reason: null });

    expect((await cancel(working.id)).status).toBe(200);
    expect((await cancel(waiting.id)).status).toBe(200);

    expect(peer.cancelled).toHaveLength(2);
    expect((await postOf(working.id)).state).toBe('working');
  });

  it('answers a second cancel without calling again', async () => {
    const asked = await ask();
    await accept(t, asked.id);
    await cancel(asked.id);

    expect((await cancel(asked.id)).status).toBe(200);
    expect(peer.cancelled).toHaveLength(1);
  });

  it('refuses a request that was answered, failed or was never delivered', async () => {
    const [answered, failed, rejected] = [await ask(), await ask(), await ask()];
    await receivingRun(answered.id, 'succeeded');
    await receivingRun(failed.id, 'failed');
    await closePost(t.db, rejected.id, { state: 'rejected', reason: 'queue_full' });

    for (const post of [answered, failed, rejected]) {
      expect(await cancel(post.id)).toMatchObject({
        status: 409,
        body: { error: REQUEST_FINISHED },
      });
    }
    expect(peer.cancelled).toEqual([]);
  });

  it('refuses a note, a notice, an unknown post and a post of another outpost', async () => {
    const note = await ask('Shipping Friday.');
    const notice = (await detail()).posts[0]!;
    const other = randomUUID();
    await send('post', '/api/outposts', { id: other, name: 'Second', members: [] });
    const asked = await ask();

    for (const post of [note, notice]) {
      expect(await cancel(post.id)).toMatchObject({
        status: 409,
        body: { error: ONLY_REQUESTS_CANCEL },
      });
    }
    expect(await cancel(randomUUID())).toMatchObject({
      status: 404,
      body: { error: POST_NOT_FOUND },
    });
    expect((await cancel(asked.id, other)).status).toBe(404);
    expect((await cancel('nope')).status).toBe(400);
  });

  it('says so and leaves the request open when the receiving chat cannot be reached', async () => {
    const asked = await ask();
    await accept(t, asked.id);
    cancelOutcome = () => Promise.reject(new Error('connect ECONNREFUSED'));

    expect(await cancel(asked.id)).toMatchObject({
      status: 503,
      body: { error: CANCEL_UNAVAILABLE },
    });
    expect((await postOf(asked.id)).state).toBe('sent');
  });
});
