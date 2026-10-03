import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const sendMessage = (conversationId: string, body: object) =>
  request(app)
    .post(`/api/conversations/${conversationId}/messages`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send(body);

async function counts(conversationId: string) {
  const { rows } = await t.db.query<{ messages: number; runs: number; jobs: number }>(
    `SELECT
       (SELECT count(*)::int FROM messages WHERE conversation_id = $1) AS messages,
       (SELECT count(*)::int FROM runs WHERE conversation_id = $1) AS runs,
       (SELECT count(*)::int FROM jobs j JOIN runs r ON r.id = j.run_id
         WHERE r.conversation_id = $1) AS jobs`,
    [conversationId],
  );
  return rows[0];
}

describe('sending the same message more than once', () => {
  it('answers a retry with the message and run it already saved', async () => {
    const chat = randomUUID();
    const body = { id: randomUUID(), content: 'open PR' };

    const first = await sendMessage(chat, body).expect(201);
    const retry = await sendMessage(chat, body).expect(201);

    expect(retry.body.message.id).toBe(first.body.message.id);
    expect(retry.body.run.id).toBe(first.body.run.id);
    expect(await counts(chat)).toEqual({ messages: 1, runs: 1, jobs: 1 });
  });

  it('saves one message and one run when the same send arrives concurrently', async () => {
    const chat = randomUUID();
    const body = { id: randomUUID(), content: 'open PR' };

    const responses = await Promise.all(Array.from({ length: 4 }, () => sendMessage(chat, body)));

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(responses.map((response) => response.body.run.id)).size).toBe(1);
    expect(await counts(chat)).toEqual({ messages: 1, runs: 1, jobs: 1 });
  });

  it('keeps messages with different keys apart', async () => {
    const chat = randomUUID();

    await Promise.all([
      sendMessage(chat, { id: randomUUID(), content: 'open PR' }).expect(201),
      sendMessage(chat, { id: randomUUID(), content: 'open pr' }).expect(201),
    ]);

    expect(await counts(chat)).toEqual({ messages: 2, runs: 2, jobs: 2 });
  });

  it('refuses to reuse a key for different text', async () => {
    const chat = randomUUID();
    const id = randomUUID();

    await sendMessage(chat, { id, content: 'open PR' }).expect(201);
    await sendMessage(chat, { id, content: 'open pr' }).expect(409);

    expect(await counts(chat)).toEqual({ messages: 1, runs: 1, jobs: 1 });
  });
});
