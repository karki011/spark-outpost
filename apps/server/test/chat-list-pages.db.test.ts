import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CHAT_LIST_PAGE } from '@spark-outpost/contracts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
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

async function seedChats(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  await t.db.query(
    `INSERT INTO conversations (id, workspace_id, title, updated_at)
     SELECT id, $2, 'Chat', now() - make_interval(secs => ord)
     FROM unnest($1::uuid[]) WITH ORDINALITY AS listed(id, ord)`,
    [ids, t.workspaceId],
  );
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content)
     SELECT gen_random_uuid(), id, 'user', 'hi' FROM unnest($1::uuid[]) AS listed(id)`,
    [ids],
  );
  return ids;
}

const list = async (query = '') =>
  (await request(app).get(`/api/conversations${query}`).set(LOCAL_HEADERS).expect(200)).body as {
    id: string;
  }[];

it('pages through every chat, newest first, with none repeated or lost', async () => {
  const ids = await seedChats(CHAT_LIST_PAGE + 3);
  const head = await list();
  expect(head.map((chat) => chat.id)).toEqual(ids.slice(0, CHAT_LIST_PAGE));
  const rest = await list(`?after=${head.at(-1)!.id}`);
  expect(rest.map((chat) => chat.id)).toEqual(ids.slice(CHAT_LIST_PAGE));
  expect(await list(`?after=${rest.at(-1)!.id}`)).toEqual([]);
});

it('keeps pinned chats ahead of the page break and breaks equal times by id', async () => {
  const ids = await seedChats(4);
  await t.db.query(`UPDATE conversations SET updated_at = '2026-01-01' WHERE id = ANY($1)`, [ids]);
  await t.db.query(`UPDATE conversations SET pinned_at = now() WHERE id = $1`, [ids[3]]);
  const all = (await list()).map((chat) => chat.id);
  expect(all[0]).toBe(ids[3]);
  const after = await list(`?after=${all[1]}`);
  expect(after.map((chat) => chat.id)).toEqual(all.slice(2));
});

it('refuses an after that is not a chat id, and answers nothing for one that is gone', async () => {
  await request(app).get('/api/conversations?after=nope').set(LOCAL_HEADERS).expect(400);
  expect(await list(`?after=${randomUUID()}`)).toEqual([]);
});

it('lets a paired device page too', async () => {
  const ids = await seedChats(2);
  await turnRemoteOn(app);
  const device = await pairDevice(app);
  const phone = remoteClient(app, device.cookie);
  const page = await phone.get(`/api/conversations?after=${ids[0]}`).expect(200);
  expect((page.body as { id: string }[]).map((chat) => chat.id)).toEqual([ids[1]]);
});
