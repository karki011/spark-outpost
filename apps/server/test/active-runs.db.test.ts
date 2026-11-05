import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, HOST, localClient } from './app-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let client: ReturnType<typeof localClient>;

beforeEach(async () => {
  t = await createTestDb();
  client = localClient(createTestApp(t));
});

afterEach(async () => {
  await t.cleanup();
});

async function setStatus(runId: string, status: string): Promise<void> {
  await t.db.query('UPDATE runs SET status = $2 WHERE id = $1', [runId, status]);
}

describe('GET /api/runs/active', () => {
  it('counts queued, running and waiting runs so the desktop app can hold an update', async () => {
    expect((await client.get('/api/runs/active').expect(200)).body).toEqual({ activeRuns: 0 });

    const queued = await startChat(t, 'first');
    const running = await startChat(t, 'second');
    const waiting = await startChat(t, 'third');
    const finished = await startChat(t, 'fourth');
    await setStatus(running.runId, 'running');
    await setStatus(waiting.runId, 'awaiting_approval');
    await setStatus(finished.runId, 'succeeded');

    expect((await client.get('/api/runs/active').expect(200)).body).toEqual({ activeRuns: 3 });
    await setStatus(queued.runId, 'cancelled');
    expect((await client.get('/api/runs/active').expect(200)).body).toEqual({ activeRuns: 2 });
  });

  it('needs the launch token like every other route', async () => {
    await request(createTestApp(t)).get('/api/runs/active').set('Host', HOST).expect(401);
  });
});
