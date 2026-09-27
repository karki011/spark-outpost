import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRun } from '../src/persistence/runs.ts';
import { usageSummarySchema } from '@spark-outpost/contracts';
import { FAKE_COST_USD, FAKE_TOKENS, createFakeProvider } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
  });
  app = createTestApp(t);
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

const post = (path: string, body: object) =>
  request(app).post(path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);

function parseSse(text: string): { id: number; type: string }[] {
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('id: '))
    .map((frame) => {
      const [idLine, dataLine] = frame.split('\n');
      return {
        id: Number(idLine!.slice(4)),
        type: (JSON.parse(dataLine!.slice(6)) as { type: string }).type,
      };
    });
}

async function completedRun(): Promise<string> {
  const conversationId = randomUUID();
  await post('/api/conversations', { id: conversationId }).expect(201);
  const sent = await post(`/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content: 'Hello',
  }).expect(201);
  const runId = sent.body.run.id as string;
  await eventually(async () => (await getRun(t.db, runId))?.finishedAt);
  return runId;
}

describe('run event stream', () => {
  it('keeps the steps of a finished run in the conversation detail', async () => {
    const runId = await completedRun();
    const run = await getRun(t.db, runId);
    const detail = await get(`/api/conversations/${run!.conversationId}`).expect(200);
    expect(detail.body.activity[runId]).toEqual([
      { name: 'Reading your message', done: true },
      { name: 'Writing a reply', done: true },
    ]);
  });

  it('replays every event in order and ends at the terminal event', async () => {
    const runId = await completedRun();
    const response = await get(`/api/runs/${runId}/events`).expect(200);
    const events = parseSse(response.text);

    expect(events.map((event) => event.id)).toEqual(events.map((_, index) => index + 1));
    expect(events[0]?.type).toBe('RUN_STARTED');
    expect(events.at(-1)?.type).toBe('RUN_FINISHED');
  });

  it('resumes after Last-Event-ID without duplicates', async () => {
    const runId = await completedRun();
    const all = parseSse((await get(`/api/runs/${runId}/events`)).text);
    const resumed = parseSse(
      (await get(`/api/runs/${runId}/events`).set('Last-Event-ID', '3')).text,
    );

    expect(resumed.map((event) => event.id)).toEqual(all.slice(3).map((event) => event.id));
  });

  it('answers 204 when a finished run has nothing after the cursor', async () => {
    const runId = await completedRun();
    const all = parseSse((await get(`/api/runs/${runId}/events`)).text);
    await get(`/api/runs/${runId}/events`).set('Last-Event-ID', String(all.length)).expect(204);
  });
});

describe('request validation and local protection', () => {
  it('rejects foreign hosts, foreign origins, and non-JSON writes', async () => {
    await request(app).get('/api/conversations').set('Host', 'evil.example:4318').expect(403);
    await request(app)
      .post('/api/conversations')
      .set(LOCAL_HEADERS)
      .set('Origin', 'https://evil.example')
      .send({ id: randomUUID() })
      .expect(403);
    await request(app)
      .post('/api/conversations')
      .set(LOCAL_HEADERS)
      .type('form')
      .send('id=1')
      .expect(415);
  });

  it('rejects invalid bodies and unknown conversations', async () => {
    await post('/api/conversations', { id: 'not-a-uuid' }).expect(400);
    await request(app).get(`/api/conversations/${randomUUID()}`).set(LOCAL_HEADERS).expect(404);
    await post(`/api/conversations/${randomUUID()}/messages`, {
      id: randomUUID(),
      content: '  ',
    }).expect(400);
  });

  it('saves a draft chat when its first message is sent', async () => {
    const id = randomUUID();
    await post(`/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Draft the launch notes',
    }).expect(201);
    const detail = await request(app)
      .get(`/api/conversations/${id}`)
      .set(LOCAL_HEADERS)
      .expect(200);
    expect(detail.body.conversation.title).toBe('Draft the launch notes');
  });

  it('summarizes usage per provider for Settings', async () => {
    await completedRun();
    const summary = await get('/api/usage/summary').expect(200);
    expect(usageSummarySchema.parse(summary.body).allTime).toEqual([
      {
        provider: 'fake',
        runs: 1,
        costUsd: FAKE_COST_USD,
        costSource: 'reported',
        inputTokens: FAKE_TOKENS.input,
        outputTokens: FAKE_TOKENS.output,
        totalTokens: FAKE_TOKENS.total,
      },
    ]);
  });
});
