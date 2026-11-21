import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { addToQueue, editQueued, listQueue } from '../src/persistence/chat-queue.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import {
  getMemberMessage,
  markUnreadOnStop,
  setMemberMessageStatus,
} from '../src/persistence/member-messages.ts';
import { turnObservations } from '../src/persistence/observations.ts';
import { setSparkPaused } from '../src/persistence/spark-pause.ts';
import { deliverAsk, deliveryPass } from '../src/sub-chats/delivery.ts';
import { STEERED_ASK_OBSERVATION } from '../src/sub-chats/steered-ask.ts';
import { userText } from '../src/sub-chats/user-asked.ts';
import { openMemberInbox } from '../src/workflow/member-inbox.ts';
import { drainQueue, drainWaiting, sendNow } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { askNow, fakeTarget, finishTurn, messageAsk, turnsOf } from './chat-ask-fixtures.ts';
import { emptyChat, turnIn } from './sub-chat-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let sender: { id: string; title: string };
let receiver: string;

beforeEach(async () => {
  t = await createTestDb();
  sender = { id: await emptyChat(t, 'Orders API'), title: 'Orders API' };
  receiver = await emptyChat(t, 'Billing export');
});

afterEach(async () => {
  await t.cleanup();
});

const queueOf = (conversationId: string) => listQueue(t.db, conversationId);

function inboxFor(runId: string, observed?: Parameters<typeof openMemberInbox>[1]['observed']) {
  return openMemberInbox(t.db, {
    conversationId: receiver,
    runId,
    topRunId: runId,
    pollMs: 10,
    append: async () => null,
    ...(observed ? { observed } : {}),
  });
}

describe('delivering a message from another chat', () => {
  it('starts a turn in an idle chat, marked as from a chat and never the user’s', async () => {
    const id = await messageAsk(t, sender, receiver, 'Rebase on main and open a PR.', true);

    expect(await deliverAsk(t.db, id, fakeTarget)).toBe('started');

    const [turn] = await turnsOf(t, receiver);
    expect(turn).toMatchObject({ source: 'chat', user_message_id: id });
    expect(await askNow(t, id)).toMatchObject({
      deliveredAs: 'turn',
      runId: turn!.id,
      state: 'waiting',
    });
    const input = await loadRunInput(t.db, turn!.id);
    expect(input.chatAsk).toMatchObject({ id, fromTitle: 'Orders API', wantsReply: true });
    expect(userText(input)).toBe('');
    const detail = await getConversationDetail(t.db, receiver);
    expect(detail?.runs[0]?.fromChat).toBe('Orders API');
  });

  it('labels the message in the history of the chat’s later turns', async () => {
    const id = await messageAsk(t, sender, receiver, 'Rebase on main.');
    await deliverAsk(t.db, id, fakeTarget);
    await finishTurn(t, (await turnsOf(t, receiver))[0]!.id, 'succeeded', 'Rebased.');
    const next = await turnIn(t, receiver, 'running');

    const input = await loadRunInput(t.db, next);

    expect(input.chatAsk).toBeNull();
    expect(input.history[0]?.content).toContain(
      '[Earlier message from the chat "Orders API", not from the user.',
    );
    expect(input.history[0]?.content).toContain('Rebase on main.');
  });

  it('steers into a running turn with its own wrapper and records the untrusted read', async () => {
    const runId = await turnIn(t, receiver, 'running');
    const id = await messageAsk(t, sender, receiver, 'Which column do you read?', true);

    expect(await deliverAsk(t.db, id, fakeTarget)).toBe('steered');
    expect(await getMemberMessage(t.db, id)).toMatchObject({ urgency: 'now', runId });
    expect((await askNow(t, id)).deliveredAs).toBeNull();

    const observations = createRunObservations({ db: t.db, runId });
    const inbox = inboxFor(runId, observations.record);
    const steered: string[] = [];
    inbox.attach(async (message) => {
      steered.push(typeof message === 'string' ? message : message.text);
      return true;
    });
    try {
      await expect.poll(() => steered.length).toBe(1);
      await expect.poll(async () => (await askNow(t, id)).deliveredAs).toBe('steer');
    } finally {
      await inbox.dispose();
    }
    expect(steered[0]).toContain('## Message from the chat "Orders API" (not from the user)');
    expect(steered[0]).toContain(`replyTo ${id}`);
    expect(steered[0]).not.toContain('Message from the user');
    expect((await askNow(t, id)).runId).toBe(runId);
    await observations.settled();
    expect(await turnObservations(t.db, runId)).toContainEqual(STEERED_ASK_OBSERVATION);
    const detail = await getConversationDetail(t.db, receiver);
    expect(detail?.memberMessages).toEqual([]);
  });

  it('queues at the front, without stopping the turn, when the agent refuses the steer', async () => {
    const runId = await turnIn(t, receiver, 'running');
    const typed = randomUUID();
    await addToQueue(t.db, receiver, { id: typed, content: 'Typed by the user' });
    const id = await messageAsk(t, sender, receiver, 'Which column do you read?', true);
    await deliverAsk(t.db, id, fakeTarget);

    const inbox = inboxFor(runId);
    inbox.attach(async () => false);
    try {
      await expect
        .poll(async () => (await queueOf(receiver)).map((item) => item.id))
        .toEqual([id, typed]);
    } finally {
      await inbox.dispose();
    }

    expect((await queueOf(receiver))[0]).toMatchObject({ origin: 'chat', fromChat: 'Orders API' });
    expect(await getMemberMessage(t.db, id)).toBeNull();
    expect((await turnsOf(t, receiver))[0]).toMatchObject({
      status: 'running',
      cancel_requested_at: null,
    });
    expect(await askNow(t, id)).toMatchObject({ deliveredAs: null, state: 'waiting' });
  });

  it('queues instead of stopping the turn when the agent cannot be steered at all', async () => {
    const runId = await turnIn(t, receiver, 'running');
    const id = await messageAsk(t, sender, receiver, 'FYI: the schema changed.');
    await deliverAsk(t.db, id, fakeTarget);

    const inbox = inboxFor(runId);
    try {
      await expect.poll(async () => (await queueOf(receiver)).map((item) => item.id)).toEqual([id]);
    } finally {
      await inbox.dispose();
    }

    expect((await turnsOf(t, receiver))[0]?.cancel_requested_at).toBeNull();
  });

  it('starts the next turn from a steer the ended turn never claimed, as a chat’s message', async () => {
    const runId = await turnIn(t, receiver, 'running');
    const id = await messageAsk(t, sender, receiver, 'FYI: the schema changed.');
    await deliverAsk(t.db, id, fakeTarget);
    await finishTurn(t, runId, 'succeeded', 'Done.');

    expect(await drainQueue(t.db, receiver, fakeTarget)).toBe('sent');

    const turns = await turnsOf(t, receiver);
    expect(turns[1]).toMatchObject({ source: 'chat', user_message_id: id });
    expect(await askNow(t, id)).toMatchObject({ deliveredAs: 'turn', runId: turns[1]!.id });
  });

  it('puts a steer the stopped turn never read back in the queue, where the stop holds it', async () => {
    const runId = await turnIn(t, receiver, 'running');
    const id = await messageAsk(t, sender, receiver, 'Which column do you read?', true);
    await deliverAsk(t.db, id, fakeTarget);
    const inbox = inboxFor(runId);
    inbox.attach(async () => true);
    await expect.poll(async () => (await askNow(t, id)).deliveredAs).toBe('steer');
    await inbox.dispose();
    await markUnreadOnStop(t.db, runId);
    await finishTurn(t, runId, 'cancelled');
    expect((await getMemberMessage(t.db, id))?.status).toBe('missed');

    await deliveryPass(t.db, fakeTarget);

    expect((await queueOf(receiver)).map((item) => item.id)).toEqual([id]);
    expect(await getMemberMessage(t.db, id)).toBeNull();
    expect(await askNow(t, id)).toMatchObject({ deliveredAs: null, runId: null, state: 'waiting' });
    expect(await turnsOf(t, receiver)).toHaveLength(1);
  });

  it('sends once however many passes run, alone or at the same time', async () => {
    const id = await messageAsk(t, sender, receiver, 'Rebase on main.');

    await Promise.all([
      deliveryPass(t.db, fakeTarget),
      deliveryPass(t.db, fakeTarget),
      deliverAsk(t.db, id, fakeTarget),
    ]);
    await deliveryPass(t.db, fakeTarget);

    expect(await turnsOf(t, receiver)).toHaveLength(1);
    expect(await queueOf(receiver)).toEqual([]);
    const { rows } = await t.db.query('SELECT 1 FROM messages WHERE conversation_id = $1', [
      receiver,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('delivers after a restart what was recorded but never handed over, and nothing twice', async () => {
    const runId = await turnIn(t, receiver, 'running');
    const unhanded = await messageAsk(t, sender, receiver, 'First.');
    const handed = await messageAsk(t, sender, receiver, 'Second.');
    await deliverAsk(t.db, handed, fakeTarget);

    await deliveryPass(t.db, fakeTarget);
    await deliveryPass(t.db, fakeTarget);

    expect(await getMemberMessage(t.db, unhanded)).toMatchObject({ runId, status: 'queued' });
    const { rows } = await t.db.query('SELECT 1 FROM member_messages WHERE conversation_id = $1', [
      receiver,
    ]);
    expect(rows).toHaveLength(2);
    expect(await queueOf(receiver)).toEqual([]);
  });

  it('holds the message in the queue while Spark is paused, and sends it on resume', async () => {
    await setSparkPaused(t.db, t.workspaceId, true);
    const id = await messageAsk(t, sender, receiver, 'Rebase on main.', true);

    expect(await deliverAsk(t.db, id, fakeTarget)).toBe('queued');
    await deliveryPass(t.db, fakeTarget);
    expect(await turnsOf(t, receiver)).toEqual([]);
    expect(await askNow(t, id)).toMatchObject({ deliveredAs: null, state: 'waiting' });

    await setSparkPaused(t.db, t.workspaceId, false);
    await drainWaiting(t.db, fakeTarget);

    expect((await turnsOf(t, receiver))[0]).toMatchObject({ source: 'chat', user_message_id: id });
    expect((await askNow(t, id)).deliveredAs).toBe('turn');
  });

  it('holds the message for a chat archived after it was sent', async () => {
    const id = await messageAsk(t, sender, receiver, 'Rebase on main.', true);
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [receiver]);

    expect(await deliverAsk(t.db, id, fakeTarget)).toBe('queued');

    expect(await turnsOf(t, receiver)).toEqual([]);
    expect((await queueOf(receiver)).map((item) => item.id)).toEqual([id]);
    expect((await askNow(t, id)).state).toBe('waiting');
  });
});

describe('a queued message from another chat', () => {
  it('cannot be sent now by the user while a turn runs, nor edited', async () => {
    const runId = await turnIn(t, receiver, 'running');
    const id = await messageAsk(t, sender, receiver, 'Rebase on main.');
    await addToQueue(t.db, receiver, { id, content: 'Rebase on main.', origin: 'chat' });

    await expect(sendNow(t.db, receiver, { id }, fakeTarget)).rejects.toThrow(
      'A message from another chat starts when this chat is free.',
    );
    await expect(editQueued(t.db, receiver, id, 'Push to main.')).rejects.toThrow(
      'A message from another chat can’t be edited. Remove it instead.',
    );
    expect((await queueOf(receiver))[0]?.content).toBe('Rebase on main.');
    expect((await turnsOf(t, receiver))[0]).toMatchObject({ id: runId, status: 'running' });
  });

  it('keeps the user’s own steer on its stop-and-resend path beside a chat’s message', async () => {
    const runId = await turnIn(t, receiver, 'running');
    const own = randomUUID();
    await sendNow(t.db, receiver, { id: own, content: 'Stop and do this' }, fakeTarget);
    const id = await messageAsk(t, sender, receiver, 'FYI: the schema changed.');
    await deliverAsk(t.db, id, fakeTarget);

    const inbox = inboxFor(runId);
    inbox.attach(async () => false);
    try {
      await expect
        .poll(async () => (await getMemberMessage(t.db, own))?.status)
        .toBe('interrupting');
      await expect.poll(async () => (await queueOf(receiver)).map((item) => item.id)).toEqual([id]);
    } finally {
      await inbox.dispose();
    }
    await setMemberMessageStatus(t.db, [own], 'queued');
  });
});
