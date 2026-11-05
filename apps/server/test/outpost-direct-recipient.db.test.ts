import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outpostDetailSchema } from '@spark-outpost/contracts';
import { NOT_A_MEMBER, outpostErrorStatus, outpostRoutes } from '../src/api/outpost-routes.ts';
import { statusForError } from '../src/api/routes.ts';
import { createOutpost } from '../src/persistence/outposts.ts';
import { fakePeerAgent } from './fake-peer-agent.ts';
import { newChat } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: express.Express;
let fe: string;
let api: { conversationId: string };
let outpostId: string;

beforeEach(async () => {
  t = await createTestDb();
  fe = await newChat(t);
  api = { conversationId: await newChat(t) };
  outpostId = randomUUID();
  await createOutpost(t.db, {
    id: outpostId,
    workspaceId: t.workspaceId,
    name: 'Orders launch',
    members: [
      { conversationId: fe, handle: 'fe' },
      { conversationId: api.conversationId, handle: 'api' },
    ],
  });
  app = express();
  app.use(express.json());
  app.use(
    '/api',
    outpostRoutes({
      db: t.db,
      workspaceId: t.workspaceId,
      peer: fakePeerAgent(),
      drain: async () => undefined,
    }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, message } = outpostErrorStatus(error) ?? statusForError(error);
    res.status(status).json({ error: message });
  });
});

afterEach(async () => {
  await t.cleanup();
});

function send(method: 'post' | 'delete', path: string, body: object = {}) {
  return request(app)[method](path).send(body);
}

async function detail() {
  const response = await request(app).get(`/api/outposts/${outpostId}`);
  expect(response.status).toBe(200);
  return outpostDetailSchema.parse(response.body);
}

describe('direct Outpost recipients', () => {
  it('sends an unchanged message to the chosen member once and keeps explicit notes separate', async () => {
    const id = randomUUID();
    const body = { id, text: 'where are we', toConversationId: api.conversationId };
    expect((await send('post', `/api/outposts/${outpostId}/posts`, body)).status).toBe(201);
    expect((await send('post', `/api/outposts/${outpostId}/posts`, body)).status).toBe(201);
    const noteId = randomUUID();
    expect(
      (
        await send('post', `/api/outposts/${outpostId}/posts`, {
          id: noteId,
          text: '@all reference only',
          to: [],
        })
      ).status,
    ).toBe(201);
    const posts = (await detail()).posts.filter((post) => post.kind !== 'notice');
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      id,
      kind: 'request',
      body: 'where are we',
      toConversationId: api.conversationId,
      toHandle: 'api',
      fromUser: true,
    });
    expect(posts[1]).toMatchObject({
      id: noteId,
      kind: 'note',
      body: '@all reference only',
      toConversationId: null,
    });
  });

  it('refuses direct targets outside the outpost, removed members and deleted chats', async () => {
    const removed = api.conversationId;
    await send('delete', `/api/outposts/${outpostId}/members/${removed}`);
    await t.db.query('DELETE FROM conversations WHERE id = $1', [fe]);
    for (const toConversationId of [await newChat(t), removed, fe]) {
      const response = await send('post', `/api/outposts/${outpostId}/posts`, {
        id: randomUUID(),
        text: 'where are we',
        toConversationId,
      });
      expect(response).toMatchObject({ status: 400, body: { error: NOT_A_MEMBER } });
    }
    expect((await detail()).posts.filter((post) => post.kind === 'request')).toEqual([]);
  });
});
