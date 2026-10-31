import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RUN_STREAM_MAX_RUNS,
  parseRunStreamFrame,
  type RunEvent,
  type RunStreamFrame,
} from '@spark-outpost/contracts';
import { RunEventHub } from '../src/api/run-event-hub.ts';
import { isCancelRequested } from '../src/persistence/run-events.ts';
import { getRun } from '../src/persistence/runs.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { seedConversation, seedTurn } from './outcome-seed.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let hub: RunEventHub;
let server: http.Server;
let port: number;
const open: http.ClientRequest[] = [];

beforeEach(async () => {
  t = await createTestDb();
  hub = new RunEventHub();
  server = createTestApp(t, { hub }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const req of open) req.destroy();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
});

const text = (delta: string): RunEvent =>
  ({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta }) as RunEvent;
const finished = (runId: string): RunEvent =>
  ({ type: 'RUN_FINISHED', threadId: 'thread', runId }) as RunEvent;

async function liveRun(): Promise<string> {
  const conversationId = await seedConversation(t.db, t.workspaceId);
  return seedTurn(t.db, conversationId, { status: 'running' });
}

async function append(runId: string, ...events: RunEvent[]): Promise<void> {
  await t.db.query(
    `INSERT INTO run_events (run_id, seq, type, payload)
     SELECT $1, COALESCE((SELECT MAX(seq) FROM run_events WHERE run_id = $1), 0) + listed.position,
       listed.type, listed.payload::jsonb
     FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS listed(type, payload, position)`,
    [runId, events.map((event) => event.type), events.map((event) => JSON.stringify(event))],
  );
  hub.notify(runId);
}

async function finish(runId: string): Promise<void> {
  await append(runId, finished(runId));
  await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
    runId,
  ]);
}

interface OpenStream {
  frames: RunStreamFrame[];
  ended: Promise<void>;
  close: () => void;
}

function stream(runs: string): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const frames: RunStreamFrame[] = [];
    let ended!: () => void;
    const endedPromise = new Promise<void>((done) => (ended = done));
    const req = http.get(
      { host: '127.0.0.1', port, path: `/api/run-events?runs=${runs}`, headers: LOCAL_HEADERS },
      (res) => {
        let buffered = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffered += chunk;
          const parts = buffered.split('\n\n');
          buffered = parts.pop()!;
          for (const part of parts) {
            if (!part.startsWith('data: ')) continue;
            const frame = parseRunStreamFrame(part.slice(6));
            if (frame) frames.push(frame);
          }
        });
        res.on('end', ended);
        res.on('close', ended);
        resolve({ frames, ended: endedPromise, close: () => req.destroy() });
      },
    );
    req.on('error', reject);
    open.push(req);
  });
}

const eventsOf = (frames: RunStreamFrame[], runId: string) =>
  frames.flatMap((frame) =>
    frame.runId === runId && 'event' in frame
      ? [{ seq: frame.seq, delta: (frame.event as { delta?: string }).delta }]
      : [],
  );
const endOf = (frames: RunStreamFrame[], runId: string) =>
  frames.find((frame) => frame.runId === runId && 'end' in frame);

describe('the shared run stream', () => {
  it('carries several live runs on one connection, in order per run, and ends each at its terminal event', async () => {
    const first = await liveRun();
    const second = await liveRun();
    const live = await stream(`${first}:0,${second}:0`);

    await append(first, text('a1'), text('a2'));
    await append(second, text('b1'));
    await append(first, text('a3'));
    await append(second, text('b2'), text('b3'));
    hub.notify(first);
    hub.notify(second);
    await eventually(async () => eventsOf(live.frames, second).length === 3);
    await eventually(async () => eventsOf(live.frames, first).length === 3);

    expect(eventsOf(live.frames, first)).toEqual([
      { seq: 1, delta: 'a1' },
      { seq: 2, delta: 'a2' },
      { seq: 3, delta: 'a3' },
    ]);
    expect(eventsOf(live.frames, second).map((event) => event.seq)).toEqual([1, 2, 3]);

    await finish(first);
    await eventually(async () => endOf(live.frames, first));
    expect(endOf(live.frames, second)).toBeUndefined();
    await append(second, text('b4'));
    await eventually(async () => eventsOf(live.frames, second).length === 4);

    await finish(second);
    await live.ended;
    expect(endOf(live.frames, second)).toEqual({ runId: second, end: 'done' });
  });

  it('resumes each run after its own cursor, with nothing sent twice', async () => {
    const first = await liveRun();
    const second = await liveRun();
    await append(first, text('a1'), text('a2'), text('a3'));
    await append(second, text('b1'), text('b2'));

    const resumed = await stream(`${first}:2,${second}:0`);
    await eventually(async () => eventsOf(resumed.frames, second).length === 2);
    await eventually(async () => eventsOf(resumed.frames, first).length === 1);
    hub.notify(first);
    await append(first, text('a4'));
    await eventually(async () => eventsOf(resumed.frames, first).length === 2);

    expect(eventsOf(resumed.frames, first).map((event) => event.seq)).toEqual([3, 4]);
    expect(eventsOf(resumed.frames, second).map((event) => event.seq)).toEqual([1, 2]);
  });

  it('sends what a run wrote after the cursor and its end when it finished while the stream was closed', async () => {
    const runId = await liveRun();
    const live = await stream(`${runId}:0`);
    await append(runId, text('one'));
    await eventually(async () => eventsOf(live.frames, runId).length === 1);
    live.close();

    await append(runId, text('two'));
    await finish(runId);

    const back = await stream(`${runId}:1`);
    await back.ended;
    expect(eventsOf(back.frames, runId).map((event) => event.delta)).toEqual(['two', undefined]);
    expect(endOf(back.frames, runId)).toEqual({ runId, end: 'done' });
  });

  it('ends a finished run with nothing after the cursor and an unknown run at once', async () => {
    const runId = await liveRun();
    await append(runId, text('one'));
    await finish(runId);
    const unknown = randomUUID();

    const answer = await request(server)
      .get(`/api/run-events?runs=${runId}:2,${unknown}:0`)
      .set(LOCAL_HEADERS)
      .expect(200);
    const frames = answer.text
      .split('\n\n')
      .filter((part) => part.startsWith('data: '))
      .map((part) => parseRunStreamFrame(part.slice(6)));

    expect(frames).toEqual([
      { runId, end: 'done' },
      { runId: unknown, end: 'missing' },
    ]);
  });

  it('never cancels or changes a run when its stream disconnects', async () => {
    const runId = await liveRun();
    const live = await stream(`${runId}:0`);
    await append(runId, text('one'));
    await eventually(async () => eventsOf(live.frames, runId).length === 1);
    live.close();
    await live.ended;
    await append(runId, text('two'));

    expect(await isCancelRequested(t.db, runId)).toBe(false);
    expect((await getRun(t.db, runId))?.status).toBe('running');
  });

  it('refuses a missing, malformed, repeated or oversized list of runs', async () => {
    const id = randomUUID();
    const tooMany = Array.from({ length: RUN_STREAM_MAX_RUNS + 1 }, () => `${randomUUID()}:0`);
    for (const runs of ['', `${id}`, `${id}:-1`, `${id}:x`, 'nope:0', `${id}:0,${id}:1`]) {
      await request(server)
        .get(`/api/run-events?runs=${encodeURIComponent(runs)}`)
        .set(LOCAL_HEADERS)
        .expect(400);
    }
    await request(server)
      .get(`/api/run-events?runs=${tooMany.join(',')}`)
      .set(LOCAL_HEADERS)
      .expect(400);
    await request(server).get('/api/run-events').set(LOCAL_HEADERS).expect(400);
  });
});
