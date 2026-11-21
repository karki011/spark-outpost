import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppEventFeed, listenForAppEvents } from '../src/api/app-events.ts';
import { listQueue } from '../src/persistence/chat-queue.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import type { Provider } from '../src/providers/provider.ts';
import { askDelivery, type AskDelivery } from '../src/sub-chats/delivery.ts';
import { TAKEN_FROM_TURN } from '../src/sub-chats/message-prompt.ts';
import { STEERED_ASK_OBSERVATION } from '../src/sub-chats/steered-ask.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { askNow, fakeTarget, messageAsk, turnsOf, type TurnRow } from './chat-ask-fixtures.ts';
import { emptyChat } from './sub-chat-fixtures.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

const HOLD = '#hold';
const TAKES_STEERS = '#takes-steers';
const BEFORE_STEER = 'Working on the export. ';
const AFTER_STEER = 'It reads total_cents.';

let t: TestDb;
let worker: Worker;
let delivery: AskDelivery;
let events: { close(): Promise<void> };
let release: () => void;
let steered: string[];
let sender: { id: string; title: string };
let receiver: string;

function scriptedProvider(held: Promise<void>): Provider {
  const fake = createFakeProvider({ stepMs: 0, wordMs: 0 });
  return {
    name: fake.name,
    async *run(turn) {
      const stopped = new Promise<void>((resolve) => {
        turn.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (turn.prompt.includes(TAKES_STEERS)) {
        const taken = new Promise<void>((resolve) => {
          turn.steering?.attach(async (message) => {
            steered.push(typeof message === 'string' ? message : message.text);
            resolve();
            return true;
          });
        });
        yield { kind: 'text_delta', delta: BEFORE_STEER };
        await Promise.race([taken, stopped, held]);
        yield { kind: 'text_delta', delta: AFTER_STEER };
        return;
      }
      if (turn.prompt.includes(HOLD)) await Promise.race([held, stopped]);
      yield* fake.run(turn);
    },
  };
}

beforeEach(async () => {
  t = await createTestDb();
  steered = [];
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = scriptedProvider(held);
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
  sender = { id: await emptyChat(t, 'Orders API'), title: 'Orders API' };
  receiver = await emptyChat(t, 'Billing export');
});

afterEach(async () => {
  release();
  await delivery.close();
  await worker.stop();
  await events.close();
  await t.cleanup();
});

async function userTurn(conversationId: string, content: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: crypto.randomUUID(), content, source: 'ui' },
    { provider: 'fake' },
  );
  return sent.run.id;
}

const finished = (turn: TurnRow | undefined, source: string) =>
  turn?.source === source && turn.status === 'succeeded' ? turn : null;

async function replyDeliveredToSender(askId: string): Promise<string> {
  const turn = await eventually(async () => finished((await turnsOf(t, sender.id))[0], 'chat'));
  const { rows } = await t.db.query<{ body: string; id: string }>(
    `SELECT id, body FROM chat_asks WHERE reply_to = $1 AND kind = 'reply'`,
    [askId],
  );
  expect(rows).toHaveLength(1);
  expect(turn.user_message_id).toBe(rows[0]!.id);
  expect((await askNow(t, askId)).state).toBe('replied');
  return rows[0]!.body;
}

describe('two chats on the fake provider exchange an ask and a reply', () => {
  it('when the receiving chat is idle: its turn’s reply comes back as a turn', async () => {
    const id = await messageAsk(t, sender, receiver, 'Which column do you read?', true);

    const reply = await replyDeliveredToSender(id);

    const [turn] = await turnsOf(t, receiver);
    expect(turn).toMatchObject({ source: 'chat', user_message_id: id, status: 'succeeded' });
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toContain(TAKEN_FROM_TURN);
  });

  it('when the receiving agent cannot take a steer: it queues, the turn goes on, then it runs', async () => {
    const busy = await userTurn(receiver, `Export the totals ${HOLD}`);
    await eventually(async () => (await turnsOf(t, receiver))[0]?.status === 'running');
    const id = await messageAsk(t, sender, receiver, 'Which column do you read?', true);

    await eventually(async () => (await listQueue(t.db, receiver))[0]?.id === id);
    const [held] = await turnsOf(t, receiver);
    expect(held).toMatchObject({ id: busy, status: 'running', cancel_requested_at: null });
    expect((await askNow(t, id)).state).toBe('waiting');

    release();
    await replyDeliveredToSender(id);

    const turns = await turnsOf(t, receiver);
    expect(turns.map((turn) => [turn.source, turn.status])).toEqual([
      ['ui', 'succeeded'],
      ['chat', 'succeeded'],
    ]);
    expect(turns[1]?.user_message_id).toBe(id);
  });

  it('when the receiving agent takes the steer: what it wrote afterwards comes back', async () => {
    const busy = await userTurn(receiver, `Export the totals ${TAKES_STEERS}`);
    await eventually(async () => {
      const { rowCount } = await t.db.query(
        `SELECT 1 FROM run_events WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'`,
        [busy],
      );
      return rowCount === 1;
    });
    const id = await messageAsk(t, sender, receiver, 'Which column do you read?', true);

    const reply = await replyDeliveredToSender(id);

    expect(reply).toBe(`${AFTER_STEER}\n\n${TAKEN_FROM_TURN}`);
    expect(steered).toHaveLength(1);
    expect(steered[0]).toContain('## Message from the chat "Orders API" (not from the user)');
    expect(steered[0]).toContain(`Answer with spark_send_to_chat, replyTo ${id}.`);
    expect(await askNow(t, id)).toMatchObject({ deliveredAs: 'steer', runId: busy });
    expect(await turnsOf(t, receiver)).toHaveLength(1);
    const { rows } = await t.db.query<{ payload: { params?: { label?: string } } }>(
      `SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = 'spark/observed'`,
      [busy],
    );
    expect(rows.map((row) => row.payload.params?.label)).toContain(STEERED_ASK_OBSERVATION.label);
  });
});
