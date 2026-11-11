import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestStateSchema, type DigestState } from '@spark-outpost/contracts';
import { createFakeProvider, FAKE_UNKNOWN_ITEM } from '../src/providers/fake.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let worker: Worker;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  app = createTestApp(t, { secrets: memorySecretStore(), fetch, linearApiUrl: stubs.linearUrl });
  const fake = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', fake]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
  });
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Ada', 'claude', now())`,
    [t.workspaceId],
  );
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, 'claude', 'cli', 'claude test', '[]', NULL, 'ask', 'high', now())`,
    [t.workspaceId],
  );
});

afterEach(async () => {
  await worker.stop();
  await stubs.close();
  await t.cleanup();
});

const send = (method: 'put' | 'patch' | 'post', url: string, body: object = {}) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

async function brief(trigger: 'open' | 'refresh'): Promise<DigestState> {
  const response = await send('post', '/api/home/digest?tz=UTC', { trigger }).expect(200);
  return digestStateSchema.parse(response.body);
}

async function ready(): Promise<DigestState> {
  return eventually(async () => {
    const response = await request(app).get('/api/home/digest').set(LOCAL_HEADERS);
    const state = digestStateSchema.parse(response.body);
    return state.digest?.status === 'ready' || state.digest?.status === 'failed' ? state : null;
  }, 10_000);
}

async function digestCount(): Promise<number> {
  const { rows } = await t.db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM digests',
  );
  return rows[0]!.count;
}

function dueTomorrow(key: string) {
  const tomorrow = new Date(Date.now() + 24 * 3_600_000);
  stubs.linear.issues.find((issue) => issue.identifier === key)!.dueDate = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, '0'),
    String(tomorrow.getDate()).padStart(2, '0'),
  ].join('-');
}

async function flag(key: string) {
  dueTomorrow(key);
  await request(app)
    .get('/api/tickets/inbox')
    .set(LOCAL_HEADERS)
    .set('Cache-Control', 'no-cache')
    .expect(200);
}

describe('ticket brief', () => {
  beforeEach(async () => {
    await send('put', '/api/tickets/connections/linear', {
      source: 'linear',
      apiKey: LINEAR_KEY,
    }).expect(200);
  });

  it('summarises flagged tickets on the middle tier even without chat activity', async () => {
    await flag('OPS-4');
    const started = await brief('open');
    expect(started.digest).toMatchObject({ status: 'running', modelLabel: 'Sonnet 5' });
    const done = await ready();
    expect(done.digest?.status).toBe('ready');
    expect(done.digest?.body?.items).toEqual([
      { itemId: 'ticket:linear:OPS-4', text: 'Handle OPS-4: Due tomorrow.' },
    ]);
    expect(JSON.stringify(done.digest?.body)).not.toContain(FAKE_UNKNOWN_ITEM);
    const { rows } = await t.db.query<{ content: string }>(
      `SELECT m.content FROM messages m JOIN digests d ON d.conversation_id = m.conversation_id`,
    );
    expect(rows[0]!.content).toContain('"flagged"');
    expect(rows[0]!.content).not.toContain('Acceptance criteria');
  });

  it('skips the model while the flagged set is unchanged and runs again when it changes', async () => {
    await flag('OPS-4');
    await brief('refresh');
    await ready();
    await t.db.query(`UPDATE digests SET created_at = created_at - interval '11 minutes'`);
    await request(app).get('/api/tickets/inbox').set(LOCAL_HEADERS).expect(200);
    await brief('refresh');
    expect(await digestCount()).toBe(1);

    await flag('ENG-12');
    const again = await brief('refresh');
    expect(again.digest?.status).toBe('running');
    expect(await digestCount()).toBe(2);
    await ready();
  });

  it('never calls a model when the brief is switched off', async () => {
    await flag('OPS-4');
    await send('patch', '/api/tickets/attention-settings', { briefEnabled: false }).expect(200);
    await brief('refresh');
    expect(await digestCount()).toBe(0);
  });
});
