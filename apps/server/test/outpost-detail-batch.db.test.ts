import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outpostDetailSchema, type OutpostDetail } from '@spark-outpost/contracts';
import { outpostRoutes } from '../src/api/outpost-routes.ts';
import type { Db } from '../src/persistence/db.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { closePost } from '../src/persistence/outpost-posts.ts';
import { fakePeerAgent } from './fake-peer-agent.ts';
import {
  acceptRequestRow,
  addMemberChat,
  createOutpostRow,
  insertRequestRow,
} from './outpost-fixtures.ts';
import { accept, carry, chatWithTurn, reply, setRun } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let queries: number;
let app: express.Express;
let outpostId: string;
let fe: string;
let api: string;

function counted(db: Db): Db {
  return new Proxy(db, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (key !== 'query') return value;
      return (...args: unknown[]) => {
        queries += 1;
        return (value as (...call: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

beforeEach(async () => {
  t = await createTestDb();
  queries = 0;
  app = express();
  app.use(express.json());
  app.use(
    '/api',
    outpostRoutes({
      db: counted(t.db),
      workspaceId: t.workspaceId,
      peer: fakePeerAgent({}),
      drain: async () => undefined,
    }),
  );
  outpostId = await createOutpostRow(t);
  fe = await addMemberChat(t, outpostId, 'fe');
  api = await addMemberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

async function detail(): Promise<OutpostDetail> {
  const response = await request(app).get(`/api/outposts/${outpostId}`);
  expect(response.status).toBe(200);
  return outpostDetailSchema.parse(response.body);
}

async function userRequest(to: string, handle: string): Promise<string> {
  return insertRequestRow(t.db, { outpostId, toConversationId: to, toHandle: handle });
}

async function agentRequest(to: string, handle: string): Promise<string> {
  const id = await userRequest(to, handle);
  await t.db.query('UPDATE outpost_posts SET from_user = false, from_handle = $2 WHERE id = $1', [
    id,
    handle === 'api' ? 'fe' : 'api',
  ]);
  return id;
}

async function answered(text: string, to: string, handle: string): Promise<string> {
  const turn = await chatWithTurn(t);
  await t.db.query('UPDATE runs SET conversation_id = $2 WHERE id = $1', [turn.runId, to]);
  const id = await userRequest(to, handle);
  await carry(t, id, turn.runId);
  await setRun(t, turn.runId, 'succeeded');
  await reply(t, turn.runId, text);
  return id;
}

async function exchange(): Promise<void> {
  const chat = await chatWithTurn(t);
  const { rows } = await t.db.query<{ user_message_id: string }>(
    'SELECT user_message_id FROM runs WHERE id = $1',
    [chat.runId],
  );
  const postId = rows[0]!.user_message_id;
  await t.db.query("UPDATE runs SET source = 'outpost', conversation_id = $2 WHERE id = $1", [
    chat.runId,
    api,
  ]);
  await t.db.query('UPDATE messages SET conversation_id = $2 WHERE id = $1', [postId, api]);
  await t.db.query(
    `INSERT INTO outpost_posts
       (id, outpost_id, kind, body, from_user, to_handle, to_conversation_id, task_id, run_id)
     VALUES ($1, $2, 'request', 'Which shape?', true, 'api', $3, $4, $5)`,
    [postId, outpostId, api, randomUUID(), chat.runId],
  );
  await setRun(t, chat.runId, 'succeeded');
  await reply(t, chat.runId, 'Two shapes.\n\nNeeds you: pick v1 or v2.');
  const second = await sendUserMessage(
    t.db,
    api,
    { id: randomUUID(), content: 'Use v2.', source: 'ui' },
    { provider: 'fake' },
    t.workspaceId,
  );
  await t.db.query('UPDATE outpost_posts SET run_id = $2 WHERE id = $1', [postId, second.run.id]);
  await setRun(t, second.run.id, 'succeeded');
  await reply(t, second.run.id, 'Done with v2.');
}

async function seed(): Promise<void> {
  await answered('Use v2.', api, 'api');
  await exchange();
  const failed = await answered('x', api, 'api');
  await t.db.query(
    `UPDATE runs SET status = 'failed' WHERE id = (SELECT run_id FROM outpost_posts WHERE id = $1)`,
    [failed],
  );
  await closePost(t.db, await userRequest(fe, 'fe'), { state: 'cancelled', reason: null });
  await acceptRequestRow(t.db, await userRequest(fe, 'fe'));
  await userRequest(api, 'api');
  await accept(t, await agentRequest(api, 'api'));
  await t.db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user)
     VALUES ($1, $2, 'note', 'A note', true)`,
    [randomUUID(), outpostId],
  );
  await t.db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_conversation_id, from_handle)
     VALUES ($1, $2, 'notice', 'api joined', $3, 'api')`,
    [randomUUID(), outpostId, api],
  );
}

async function more(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await answered(`Answer ${index}`, fe, 'fe');
}

describe('the outpost detail batches its reads', () => {
  it('shows each request with its state, answer and exchanges', async () => {
    await seed();
    await more(2);
    const shown = await detail();
    expect(
      shown.posts.map((p) => [p.kind, p.state, p.answer?.text ?? null, p.exchanges, p.reason]),
    ).toEqual([
      ['request', 'answered', 'Use v2.', [], null],
      [
        'request',
        'answered',
        'Done with v2.',
        [{ question: 'Two shapes.\n\nNeeds you: pick v1 or v2.', answer: 'Use v2.' }],
        null,
      ],
      ['request', 'failed', null, [], "@api's turn failed"],
      ['request', 'cancelled', null, [], null],
      ['request', 'sent', null, [], null],
      ['request', 'sent', null, [], 'Not sent yet'],
      ['request', 'sent', null, [], "Waiting: @api's last turn failed"],
      ['note', null, null, [], null],
      ['notice', null, null, [], null],
      ['request', 'answered', 'Answer 0', [], null],
      ['request', 'answered', 'Answer 1', [], null],
    ]);
    expect(shown.outpost.needsYou).toBe(0);
  });

  it('issues the same number of queries for few posts and for many', async () => {
    await seed();
    await more(1);
    queries = 0;
    const few = await detail();
    const small = queries;
    await more(25);
    queries = 0;
    const many = await detail();
    expect(many.posts.length).toBeGreaterThan(few.posts.length + 20);
    expect(queries).toBe(small);
  });
});
