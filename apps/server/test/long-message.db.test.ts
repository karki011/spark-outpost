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

const post = (path: string, body: object) =>
  request(app).post(`/api${path}`).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

const sendMessage = (conversationId: string, content: string) =>
  post(`/conversations/${conversationId}/messages`, { id: randomUUID(), content });

function longText(length: number): string {
  const line = 'The quick brown fox jumps over the lazy dog. ';
  return line.repeat(Math.ceil(length / line.length)).slice(0, length - 1) + '!';
}

async function stored(conversationId: string) {
  const { rows } = await t.db.query<{ content: string; runs: number; jobs: number }>(
    `SELECT m.content,
       (SELECT count(*)::int FROM runs WHERE conversation_id = $1) AS runs,
       (SELECT count(*)::int FROM jobs j JOIN runs r ON r.id = j.run_id
         WHERE r.conversation_id = $1) AS jobs
     FROM messages m WHERE m.conversation_id = $1 AND m.role = 'user'`,
    [conversationId],
  );
  return rows;
}

describe('a very long message', { timeout: 60_000 }, () => {
  it('stores 100,000 characters whole and starts the run', async () => {
    const chat = randomUUID();
    const content = longText(100_000);

    const sent = await sendMessage(chat, content).expect(201);

    expect(sent.body.message.content).toBe(content);
    expect(sent.body.run.status).toBe('queued');
    expect(await stored(chat)).toEqual([{ content, runs: 1, jobs: 1 }]);
  });

  it('accepts a message larger than the body limit other routes keep', async () => {
    const chat = randomUUID();
    const content = longText(1_000_000);

    await sendMessage(chat, content).expect(201);

    expect(await stored(chat)).toEqual([{ content, runs: 1, jobs: 1 }]);
  });

  it('queues 100,000 characters whole behind a running turn', async () => {
    const chat = randomUUID();
    const content = longText(100_000);
    await sendMessage(chat, 'first').expect(201);

    const queued = await post(`/conversations/${chat}/queue`, { id: randomUUID(), content }).expect(
      201,
    );

    expect(queued.body.queue.map((item: { content: string }) => item.content)).toEqual([content]);
  });

  it('answers a message over 16 MB with a plain error and saves nothing', async () => {
    const chat = randomUUID();

    const refused = await sendMessage(chat, 'x'.repeat(17 * 1024 * 1024)).expect(413);

    expect(refused.body.error).toBe(
      'This message is over 16 MB, more than Spark can receive in one request. Shorten it and send again.',
    );
    expect(await stored(chat)).toEqual([]);
  });

  it('keeps the smaller body limit on routes that carry no message', async () => {
    const refused = await post('/conversations', {
      id: randomUUID(),
      padding: 'x'.repeat(300 * 1024),
    }).expect(413);

    expect(refused.body.error).toBe('That request is too large.');
  });
});
