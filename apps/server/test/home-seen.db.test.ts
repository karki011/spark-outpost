import request from 'supertest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name) VALUES ($1, 'Test')
     ON CONFLICT (workspace_id) DO NOTHING`,
    [t.workspaceId],
  );
});

afterEach(async () => {
  await t.cleanup();
});

const read = async () =>
  (await request(app).get('/api/home/seen').set(LOCAL_HEADERS).expect(200)).body as {
    seenAt: string | null;
  };

const mark = async () =>
  (await request(app).post('/api/home/seen').set(LOCAL_HEADERS).send({}).expect(200)).body as {
    seenAt: string | null;
  };

it('has no last-seen time until Home has been viewed', async () => {
  expect(await read()).toEqual({ seenAt: null });
});

it('records the server clock and keeps it for the next read', async () => {
  const before = Date.now();
  const marked = await mark();
  expect(Date.parse(marked.seenAt!)).toBeGreaterThanOrEqual(before - 1000);
  expect(await read()).toEqual(marked);
});

it('never moves the last-seen time back', async () => {
  const first = await mark();
  await t.db.query(
    `UPDATE profiles SET home_seen_at = now() + interval '1 hour' WHERE workspace_id = $1`,
    [t.workspaceId],
  );
  const later = await read();
  expect(Date.parse(later.seenAt!)).toBeGreaterThan(Date.parse(first.seenAt!));
  expect(await mark()).toEqual(later);
});
