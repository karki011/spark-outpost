import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem, AttentionList, ConversationSummary } from '@spark-outpost/contracts';
import { listen } from '../src/persistence/notifications.ts';
import { insertRailFlag } from '../src/persistence/rail-flags.ts';
import { createTestApp, localClient } from './app-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, eventually, startChat, testDatabaseUrl, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

async function items(): Promise<AttentionItem[]> {
  return ((await localClient(app).get('/api/attention').expect(200)).body as AttentionList).items;
}

async function itemFor(key: string): Promise<AttentionItem | undefined> {
  return (await items()).find((item) => item.key === key);
}

async function summary(id: string): Promise<ConversationSummary> {
  const listed = (await localClient(app).get('/api/conversations').expect(200))
    .body as ConversationSummary[];
  return listed.find((chat) => chat.id === id)!;
}

async function raiseCard(runId: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `UPDATE runs SET status = 'awaiting_approval', started_at = now() WHERE id = $1`,
    [runId],
  );
  await t.db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status)
     VALUES ($1, $2, $3, 'execute', 'Run tests', '{"command":"pnpm test"}',
       'sha256:inbox', '[]', 'pending')`,
    [id, runId, `call-${id}`],
  );
  return id;
}

async function answer(approvalId: string): Promise<void> {
  await t.db.query(`UPDATE approvals SET status = 'allowed', decided_at = now() WHERE id = $1`, [
    approvalId,
  ]);
}

async function finish(runId: string, status: 'succeeded' | 'failed'): Promise<void> {
  await t.db.query(
    `UPDATE runs SET status = $2, started_at = now(), finished_at = now(),
       error = CASE WHEN $2 = 'failed' THEN 'Tests failed' END WHERE id = $1`,
    [runId, status],
  );
}

function mark(key: string, what: 'read' | 'set-aside' | 'dismiss') {
  return localClient(app).send('post', `/api/attention/${key}/${what}`);
}

describe('attention items', () => {
  it('lists a waiting card as blocking and unread until it is read, keeping the first read time', async () => {
    const { conversationId, runId } = await startChat(t, 'Ask me');
    const card = await raiseCard(runId);
    const key = `approval:${card}`;
    expect(await itemFor(key)).toMatchObject({
      kind: 'approval',
      blocking: true,
      conversationId,
      readAt: null,
      setAsideAt: null,
      dismissedAt: null,
    });

    await mark(key, 'read').expect(204);
    const first = (await itemFor(key))!.readAt;
    expect(first).not.toBeNull();
    await mark(key, 'read').expect(204);
    expect((await itemFor(key))!.readAt).toBe(first);
  });

  it('drops a card once it is answered, whether or not it was read first', async () => {
    const { runId } = await startChat(t, 'Answer me');
    const card = await raiseCard(runId);
    await mark(`approval:${card}`, 'read').expect(204);
    await answer(card);
    expect(await itemFor(`approval:${card}`)).toBeUndefined();
  });

  it('brings back a set-aside or dismissed chat only for a new card', async () => {
    const { conversationId, runId } = await startChat(t, 'Later please');
    const first = await raiseCard(runId);
    await mark(`approval:${first}`, 'set-aside').expect(204);
    await mark(`approval:${first}`, 'dismiss').expect(204);
    expect(await itemFor(`approval:${first}`)).toMatchObject({
      setAsideAt: expect.any(String),
      dismissedAt: expect.any(String),
      readAt: expect.any(String),
    });

    await answer(first);
    const second = await raiseCard(runId);
    expect(await itemFor(`approval:${second}`)).toMatchObject({
      conversationId,
      readAt: null,
      setAsideAt: null,
      dismissedAt: null,
    });
  });

  it('reads every item of a chat when the chat is opened, and only that chat', async () => {
    const opened = await startChat(t, 'Open me');
    const other = await startChat(t, 'Leave me');
    const card = await raiseCard(opened.runId);
    const otherCard = await raiseCard(other.runId);

    await localClient(app)
      .send('post', `/api/attention/chats/${opened.conversationId}/read`)
      .expect(204);
    expect((await itemFor(`approval:${card}`))!.readAt).not.toBeNull();
    expect((await itemFor(`approval:${otherCard}`))!.readAt).toBeNull();

    const later = await raiseCard(opened.runId);
    expect((await itemFor(`approval:${later}`))!.readAt).toBeNull();
  });

  it('keeps a rail flag out of needs you and shows it as an update until dismissed', async () => {
    const { conversationId, runId } = await startChat(t, 'Send it');
    await finish(runId, 'succeeded');
    await localClient(app).send('post', `/api/conversations/${conversationId}/seen`);
    const flag = await insertRailFlag(t.db, runId, 'Claude', {
      toolCallId: null,
      rail: 'sent_out',
      paths: ['https://example.com'],
      inside: false,
      originals: [],
      read: ['.env'],
    });
    const key = `flag:${flag!.id}`;
    const chat = await summary(conversationId);
    expect(chat.needsInput).toBe(false);
    expect(chat.waitingSince).toBeNull();
    expect(chat.attention).toMatchObject({ kind: 'flag', title: flag!.title });
    expect(await itemFor(key)).toMatchObject({ kind: 'flag', blocking: false, readAt: null });

    await mark(key, 'dismiss').expect(204);
    expect(await itemFor(key)).toBeUndefined();
    expect((await summary(conversationId)).attention).toBeNull();
  });

  it('lists a finished or failed turn as an update until read', async () => {
    const done = await startChat(t, 'Finish');
    await finish(done.runId, 'succeeded');
    const failed = await startChat(t, 'Fail');
    await finish(failed.runId, 'failed');
    expect(await itemFor(`run-done:${done.runId}`)).toMatchObject({ blocking: false });
    expect(await itemFor(`run-failed:${failed.runId}`)).toMatchObject({
      blocking: false,
      detail: 'Tests failed',
    });

    await mark(`run-done:${done.runId}`, 'read').expect(204);
    expect(await itemFor(`run-done:${done.runId}`)).toBeUndefined();
    await localClient(app).send('post', `/api/conversations/${failed.conversationId}/seen`);
    expect(await itemFor(`run-failed:${failed.runId}`)).toBeUndefined();
  });

  it('refuses a key that is malformed or belongs to nothing', async () => {
    await mark(`approval:${randomUUID()}`, 'read').expect(404);
    await mark('chat:nope', 'read').expect(404);
    await localClient(app).send('post', `/api/attention/chats/${randomUUID()}/read`).expect(404);
  });

  it('tells every open app that an item changed', async () => {
    const { conversationId, runId } = await startChat(t, 'Notify');
    const card = await raiseCard(runId);
    const payloads: string[] = [];
    const raw = await listen(testDatabaseUrl(), 'changes', (payload) => payloads.push(payload));
    try {
      await mark(`approval:${card}`, 'read').expect(204);
      const event = await eventually(async () =>
        payloads
          .map((payload) => JSON.parse(payload) as Record<string, unknown>)
          .find((each) => each.kind === 'attention'),
      );
      expect(event).toEqual({ kind: 'attention', conversationId, runId: null });
    } finally {
      await raw.close();
    }
  });

  it('lets a paired device mark an item read', async () => {
    await turnRemoteOn(app);
    const { runId } = await startChat(t, 'Read on the phone');
    const card = await raiseCard(runId);
    const device = await pairDevice(app, 'Pocket phone');
    const phone = remoteClient(app, device.cookie);

    await phone.send('post', `/api/attention/approval:${card}/read`, {}).expect(204);
    expect((await itemFor(`approval:${card}`))!.readAt).not.toBeNull();
  });
});
