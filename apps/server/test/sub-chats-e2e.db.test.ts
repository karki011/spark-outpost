import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppEventFeed, listenForAppEvents } from '../src/api/app-events.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { askDelivery, type AskDelivery } from '../src/sub-chats/delivery.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { fakeTarget, turnsOf } from './chat-ask-fixtures.ts';
import { addSubChat, emptyChat } from './sub-chat-fixtures.ts';
import { asksOf, startTask } from './sub-chat-report-fixtures.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let delivery: AskDelivery;
let events: { close(): Promise<void> };
let parent: string;

beforeEach(async () => {
  t = await createTestDb();
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  delivery = askDelivery(t.db, fakeTarget);
  const feed = new AppEventFeed(undefined, (event) => delivery.changed(event));
  events = await listenForAppEvents(testDatabaseUrl(), feed);
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    inboxPollMs: 20,
    queueTarget: fakeTarget,
  });
  parent = await emptyChat(t, 'Checkout rework');
});

afterEach(async () => {
  await delivery.close();
  await worker.stop();
  await events.close();
  await t.cleanup();
});

async function startedAt(conversationId: string): Promise<Date | null> {
  const { rows } = await t.db.query<{ started_at: Date | null }>(
    'SELECT started_at FROM sub_chats WHERE conversation_id = $1',
    [conversationId],
  );
  return rows[0]?.started_at ?? null;
}

describe('a three-piece plan on the fake provider', { timeout: 60_000 }, () => {
  it('reports, starts its Held pieces by itself and ends with one read-only wrap-up', async () => {
    const api = await addSubChat(t, parent, 'Orders API');
    const page = await addSubChat(t, parent, 'Orders page', { stackedOn: api });
    const docs = await addSubChat(t, parent, 'Docs', { startsAfter: [api, page] });

    const task = await startTask(t, api);

    const wrapUp = await eventually(async () => (await asksOf(t, parent, 'wrap_up'))[0] ?? null);
    const reports = await asksOf(t, parent, 'report');
    expect(reports.map((report) => report.from.title)).toEqual([
      'Orders API',
      'Orders page',
      'Docs',
    ]);
    expect(reports[0]!.replyTo).toBe(task.askId);
    expect(reports.every((report) => report.report?.reason === null)).toBe(true);
    expect(await startedAt(page)).not.toBeNull();
    expect(await startedAt(docs)).not.toBeNull();
    for (const chat of [api, page, docs]) {
      expect((await turnsOf(t, chat)).map((turn) => turn.source)).toEqual(['chat']);
    }

    const turn = await eventually(async () => {
      const found = (await turnsOf(t, parent)).find((each) => each.user_message_id === wrapUp.id);
      return found?.status === 'succeeded' ? found : null;
    });
    const { rows } = await t.db.query<{ mode: string }>('SELECT mode FROM runs WHERE id = $1', [
      turn.id,
    ]);
    expect(rows[0]?.mode).toBe('ask');
    expect(await asksOf(t, parent, 'wrap_up')).toHaveLength(1);
    const heard = new Set((await turnsOf(t, parent)).map((each) => each.user_message_id));
    expect(reports.every((report) => heard.has(report.id))).toBe(true);
    expect((await turnsOf(t, parent)).every((each) => each.source === 'chat')).toBe(true);
  });
});
