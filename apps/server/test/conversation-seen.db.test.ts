import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { listen } from '../src/persistence/notifications.ts';
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

async function summary(id: string): Promise<ConversationSummary> {
  const listed = (await localClient(app).get('/api/conversations').expect(200))
    .body as ConversationSummary[];
  const found = listed.find((chat) => chat.id === id);
  if (!found) throw new Error('Chat not listed');
  return found;
}

async function seenAtColumn(id: string): Promise<Date | null> {
  const { rows } = await t.db.query<{ seen_at: Date | null }>(
    'SELECT seen_at FROM conversations WHERE id = $1',
    [id],
  );
  return rows[0]?.seen_at ?? null;
}

async function raiseCard(runId: string, call = 'seen:call'): Promise<void> {
  await t.db.query(
    `UPDATE runs SET status = 'awaiting_approval', started_at = now() WHERE id = $1`,
    [runId],
  );
  await t.db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status)
     VALUES ($1, $2, $3, 'execute', 'Run tests', '{"command":"pnpm test"}',
       'sha256:seen', '[]', 'pending')`,
    [randomUUID(), runId, call],
  );
}

describe('seen_at', () => {
  it('records when a chat was last seen with the server clock, and 404s an unknown chat', async () => {
    const { conversationId } = await startChat(t, 'Look at this');
    const before = await seenAtColumn(conversationId);

    await localClient(app)
      .send('post', `/api/conversations/${conversationId}/seen`, {})
      .expect(204);
    const after = await seenAtColumn(conversationId);
    expect(after).not.toBeNull();
    expect(after!.getTime()).toBeGreaterThanOrEqual(before?.getTime() ?? 0);
    expect((await summary(conversationId)).seenAt).toBe(after!.toISOString());

    await localClient(app).send('post', `/api/conversations/${randomUUID()}/seen`, {}).expect(404);
  });

  it('lists when the turn finished and when a card began waiting, to compare with seen_at', async () => {
    const done = await startChat(t, 'Finish this');
    await t.db.query(
      `UPDATE runs SET status = 'succeeded', started_at = now(), finished_at = now() WHERE id = $1`,
      [done.runId],
    );
    const finished = await summary(done.conversationId);
    expect(finished.unread).toBe(true);
    expect(Date.parse(finished.latestRun!.finishedAt!)).toBeGreaterThan(
      Date.parse(finished.seenAt ?? '1970-01-01T00:00:00Z'),
    );

    await localClient(app).send('post', `/api/conversations/${done.conversationId}/seen`, {});
    const seen = await summary(done.conversationId);
    expect(seen.unread).toBe(false);
    expect(Date.parse(seen.seenAt!)).toBeGreaterThanOrEqual(
      Date.parse(seen.latestRun!.finishedAt!),
    );

    const asking = await startChat(t, 'Ask me first');
    await raiseCard(asking.runId);
    const waiting = await summary(asking.conversationId);
    expect(waiting.needsInput).toBe(true);
    expect(waiting.waitingSince).not.toBeNull();
    expect(Date.parse(waiting.waitingSince!)).toBeGreaterThan(
      Date.parse(waiting.seenAt ?? '1970-01-01T00:00:00Z'),
    );
  });

  it('waits since the newest card, so a second card after a look counts as unseen', async () => {
    const asking = await startChat(t, 'Ask twice');
    await raiseCard(asking.runId);
    await localClient(app).send('post', `/api/conversations/${asking.conversationId}/seen`, {});
    const looked = await summary(asking.conversationId);
    expect(Date.parse(looked.waitingSince!)).toBeLessThanOrEqual(Date.parse(looked.seenAt!));

    await raiseCard(asking.runId, 'seen:second');
    const again = await summary(asking.conversationId);
    expect(Date.parse(again.waitingSince!)).toBeGreaterThan(Date.parse(again.seenAt!));
  });

  it('tells every open app that the chat was seen, without moving it in the list', async () => {
    const { conversationId } = await startChat(t, 'Keep my place');
    const updatedBefore = (await summary(conversationId)).updatedAt;
    const payloads: string[] = [];
    const raw = await listen(testDatabaseUrl(), 'changes', (payload) => payloads.push(payload));
    try {
      await localClient(app).send('post', `/api/conversations/${conversationId}/seen`, {});
      const event = await eventually(async () =>
        payloads
          .map((payload) => JSON.parse(payload) as Record<string, unknown>)
          .find((each) => each.kind === 'seen' && each.conversationId === conversationId),
      );
      expect(event).toEqual({ kind: 'seen', conversationId, runId: null });
    } finally {
      await raw.close();
    }
    expect((await summary(conversationId)).updatedAt).toBe(updatedBefore);
  });

  it('lets a paired device mark a chat seen', async () => {
    await turnRemoteOn(app);
    const { conversationId } = await startChat(t, 'Seen on the phone');
    const device = await pairDevice(app, 'Pocket phone');
    const phone = remoteClient(app, device.cookie);

    await phone.send('post', `/api/conversations/${conversationId}/seen`, {}).expect(204);
    expect(await seenAtColumn(conversationId)).not.toBeNull();
  });
});
