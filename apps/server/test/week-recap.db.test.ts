import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { recapStateSchema, type RecapState } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { startWeekRecap } from '../src/recap/schedule.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
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
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function startFakeWorker() {
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', createFakeProvider({ stepMs: 0, wordMs: 0 })]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
  });
}

async function chat(title: string) {
  const id = randomUUID();
  const sent = await sendUserMessage(
    t.db,
    id,
    { id: randomUUID(), content: title },
    { provider: 'claude' },
    t.workspaceId,
  );
  await t.db.query(
    `UPDATE runs SET status = 'succeeded', started_at = now(), finished_at = now() WHERE id = $1`,
    [sent.run.id],
  );
  await t.db.query(`UPDATE jobs SET status = 'done' WHERE run_id = $1`, [sent.run.id]);
  await t.db.query('UPDATE conversations SET title = $2 WHERE id = $1', [id, title]);
  return id;
}

async function mergedPull(conversationId: string, number: number, title: string) {
  await t.db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
       branch, title, pr_state, updated_at)
     VALUES ($1, $2, $3, 'github.com', 'acme', 'shop', $4, $5, 'spark/x', $6, 'merged', now())`,
    [
      randomUUID(),
      t.workspaceId,
      conversationId,
      number,
      `https://github.com/acme/shop/pull/${number}`,
      title,
    ],
  );
}

const state = (body: unknown): RecapState => recapStateSchema.parse(body);
const post = () => request(app).post('/api/home/recap').set(LOCAL_HEADERS).send({});
const get = () => request(app).get('/api/home/recap').set(LOCAL_HEADERS);

async function ready(): Promise<RecapState> {
  return eventually(async () => {
    const current = state((await get()).body);
    return current.recap?.status === 'ready' ? current : null;
  });
}

it('writes a recap from the week, keeping only grounded items and counted totals', async () => {
  const shipped = await chat('Download prompt');
  await chat('Archived on Tuesday');
  await t.db.query(`UPDATE conversations SET archived_at = now() WHERE title = $1`, [
    'Archived on Tuesday',
  ]);
  await mergedPull(shipped, 182, 'Ask before saving downloads');
  startFakeWorker();

  expect((await post()).status).toBe(200);
  const { recap } = await ready();

  expect(recap?.totals).toEqual({ chats: 2, merged: 1, open: 0, tickets: 0 });
  expect(recap?.body?.done.map((item) => item.me)).toEqual(
    expect.arrayContaining([
      'I finished Download prompt.',
      'I finished Archived on Tuesday.',
      'I finished Ask before saving downloads #182.',
    ]),
  );
  expect(recap?.body?.done.find((item) => item.me.includes('#182'))?.url).toBe(
    'https://github.com/acme/shop/pull/182',
  );
  expect(recap?.body?.progress).toEqual([]);
  const { rows } = await t.db.query<{ kind: string; archived: boolean }>(
    `SELECT c.kind, c.archived_at IS NOT NULL AS archived
     FROM week_recaps w JOIN runs r ON r.id = w.run_id JOIN conversations c ON c.id = w.conversation_id`,
  );
  expect(rows).toEqual([{ kind: 'digest', archived: true }]);
});

it('keeps one recap running at a time', async () => {
  await chat('Busy week');
  const [first, second] = await Promise.all([post(), post()]);
  expect([first.status, second.status]).toEqual([200, 200]);
  const { rows } = await t.db.query('SELECT id FROM week_recaps');
  expect(rows).toHaveLength(1);
  expect(state(second.body).recap?.status).toBe('running');
});

it('reads a recap whose run ended unfinished as failed and lets a new one start', async () => {
  await chat('Busy week');
  await post();
  await t.db.query(
    `UPDATE runs SET status = 'failed', finished_at = now() - interval '5 minutes'
     WHERE id = (SELECT run_id FROM week_recaps)`,
  );
  expect(state((await get()).body).recap).toMatchObject({
    status: 'failed',
    error: 'The recap did not finish. Try again.',
  });
  startFakeWorker();
  await post();
  expect((await ready()).recap?.body).not.toBeNull();
  const { rows } = await t.db.query<{ status: string }>(
    'SELECT status FROM week_recaps ORDER BY created_at',
  );
  expect(rows.map((row) => row.status)).toEqual(['failed', 'ready']);
});

it('refines the text with the user request and drops numbers no fact holds', async () => {
  await chat('Download prompt');
  startFakeWorker();
  await post();
  const { recap } = await ready();
  const refine = (id: string) =>
    request(app)
      .post(`/api/home/recap/${id}/refine`)
      .set(LOCAL_HEADERS)
      .send({ voice: 'manager', text: '**Done:** downloads', instruction: 'make it shorter' });

  expect((await refine(randomUUID())).status).toBe(404);
  expect((await refine(recap!.id)).status).toBe(200);
  const refined = await eventually(async () => {
    const refine = state((await get()).body).refines[0];
    return refine?.status === 'ready' ? refine : null;
  });
  expect(refined).toMatchObject({
    voice: 'manager',
    instruction: 'make it shorter',
    textIn: '**Done:** downloads',
    textOut: '**Done:** downloads\n\n_Refined: make it shorter_',
    error: null,
  });
});

it('writes the scheduled recap once a week, after the chosen time', async () => {
  await chat('Busy week');
  await t.db.query(
    `UPDATE profiles SET week_recap_day = 1, week_recap_time = '00:00' WHERE workspace_id = $1`,
    [t.workspaceId],
  );
  const schedule = startWeekRecap(t.db, t.workspaceId, 60_000);
  try {
    await schedule.tick();
    await schedule.tick();
    const again = startWeekRecap(t.db, t.workspaceId, 60_000);
    await again.tick();
    again.stop();
  } finally {
    schedule.stop();
  }
  const { rows } = await t.db.query('SELECT id FROM week_recaps');
  expect(rows).toHaveLength(1);
});

it('writes the scheduled recap after one asked for earlier in the week', async () => {
  await chat('Busy week');
  const today = ((new Date().getDay() + 6) % 7) + 1;
  await t.db.query(
    `UPDATE profiles SET week_recap_day = $2, week_recap_time = '00:00' WHERE workspace_id = $1`,
    [t.workspaceId, today],
  );
  startFakeWorker();
  await post();
  await ready();
  const beforeDue = new Date(new Date().setHours(0, 0, 0, 0) - 60_000);
  await t.db.query('UPDATE week_recaps SET created_at = $1', [beforeDue]);
  const schedule = startWeekRecap(t.db, t.workspaceId, 60_000);
  await schedule.tick();
  await schedule.tick();
  schedule.stop();
  expect((await t.db.query('SELECT id FROM week_recaps')).rows).toHaveLength(2);
});

it('counts a pull request merged before the week as not merged this week', async () => {
  const id = await chat('Old work');
  await mergedPull(id, 150, 'Merged last month');
  await t.db.query(
    `UPDATE pr_watches SET merged_at = now() - interval '30 days', updated_at = now()`,
  );
  startFakeWorker();
  await post();
  const { recap } = await ready();
  expect(recap?.totals).toMatchObject({ merged: 0 });
  expect(JSON.stringify(recap?.body)).not.toContain('#150');
});

it('writes no scheduled recap when the recap is off', async () => {
  await chat('Busy week');
  await t.db.query(
    `UPDATE profiles SET week_recap = false, week_recap_day = 1, week_recap_time = '00:00'
     WHERE workspace_id = $1`,
    [t.workspaceId],
  );
  const schedule = startWeekRecap(t.db, t.workspaceId, 60_000);
  await schedule.tick();
  schedule.stop();
  expect((await t.db.query('SELECT id FROM week_recaps')).rows).toHaveLength(0);
  expect(state((await get()).body)).toMatchObject({ enabled: false, recap: null });
});
