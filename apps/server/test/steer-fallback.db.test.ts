import { randomUUID } from 'node:crypto';
import { EventType, SUBAGENTS_ACTIVITY, type RunEvent } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue, listQueue } from '../src/persistence/chat-queue.ts';
import { getMemberMessage } from '../src/persistence/member-messages.ts';
import { handQueueToWaitingTurn } from '../src/persistence/queue-handoff.ts';
import { setSparkPaused } from '../src/persistence/spark-pause.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { appendRunEvent } from '../src/persistence/run-events.ts';
import { openMemberInbox } from '../src/workflow/member-inbox.ts';
import { sendNow } from '../src/workflow/queue-drain.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
const target = async () => ({ provider: 'fake' });

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const waitingOn = (count: number): RunEvent => ({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId: SUBAGENTS_ACTIVITY,
  activityType: SUBAGENTS_ACTIVITY,
  content: { waitingOn: count },
  replace: true,
});

async function waitingTurn() {
  const chat = await startChat(t, 'Work');
  const lease = (await claimNextJob(t.db, 30))!;
  await appendRunEvent(t.db, lease, waitingOn(1), { transition: { status: 'running' } });
  return { ...chat, lease };
}

async function queued(conversationId: string, content: string) {
  const id = randomUUID();
  await addToQueue(t.db, conversationId, { id, content });
  return id;
}

const contents = async (conversationId: string) =>
  (await listQueue(t.db, conversationId)).map((item) => item.content);

describe('queued messages while the agent only waits', () => {
  it('hands over only what the user typed, and never twice', async () => {
    const { conversationId, runId } = await waitingTurn();
    const typed = await queued(conversationId, 'Typed');
    const fromAsk = randomUUID();
    await addToQueue(t.db, conversationId, { id: fromAsk, content: 'Ask', origin: 'assistant' });
    const spoken = randomUUID();
    await addToQueue(t.db, conversationId, { id: spoken, content: 'Said', origin: 'voice' });

    expect(await handQueueToWaitingTurn(t.db, conversationId, runId, [])).toEqual([typed]);
    expect(await handQueueToWaitingTurn(t.db, conversationId, runId, [])).toEqual([]);
    expect(await contents(conversationId)).toEqual(['Ask', 'Said']);
    expect(await getMemberMessage(t.db, typed)).toMatchObject({ urgency: 'now', runId });

    const bounced = await queued(conversationId, 'Bounced');
    expect(await handQueueToWaitingTurn(t.db, conversationId, runId, [bounced])).toEqual([]);
  });

  it('never stops the turn for a queued message the agent could not take', async () => {
    const { conversationId, runId, lease } = await waitingTurn();
    const id = await queued(conversationId, 'Typed');
    const inbox = openMemberInbox(t.db, {
      conversationId,
      runId,
      topRunId: runId,
      pollMs: 10,
      append: async () => null,
    });
    inbox.attach(async () => {
      await appendRunEvent(t.db, lease, waitingOn(0));
      return false;
    });
    try {
      await expect.poll(() => contents(conversationId)).toEqual(['Typed']);
      expect(await getMemberMessage(t.db, id)).toBeNull();
      const { rows } = await t.db.query<{ asked: Date | null }>(
        'SELECT cancel_requested_at AS asked FROM runs WHERE id = $1',
        [runId],
      );
      expect(rows[0]?.asked).toBeNull();
    } finally {
      await inbox.dispose();
    }
  });

  it('keeps them queued while the agent works or Spark is paused', async () => {
    const { conversationId, runId, lease } = await waitingTurn();
    await queued(conversationId, 'Typed');
    await setSparkPaused(t.db, t.workspaceId, true);
    expect(await handQueueToWaitingTurn(t.db, conversationId, runId, [])).toEqual([]);
    await setSparkPaused(t.db, t.workspaceId, false);
    await appendRunEvent(t.db, lease, waitingOn(0));
    expect(await handQueueToWaitingTurn(t.db, conversationId, runId, [])).toEqual([]);
    expect(await contents(conversationId)).toEqual(['Typed']);
  });
});

describe('a message sent now that the agent cannot take while it waits', () => {
  it('goes to the front of the queue, ahead of what was already waiting', async () => {
    const { conversationId, runId } = await waitingTurn();
    await queued(conversationId, 'First queued');
    await queued(conversationId, 'Second queued');
    for (const content of ['Urgent one', 'Urgent two']) {
      const outcome = await sendNow(t.db, conversationId, { id: randomUUID(), content }, target);
      expect(outcome).toBe('steering');
    }

    const inbox = openMemberInbox(t.db, {
      conversationId,
      runId,
      topRunId: runId,
      pollMs: 10,
      append: async () => null,
    });
    try {
      await expect
        .poll(() => contents(conversationId))
        .toEqual(['Urgent one', 'Urgent two', 'First queued', 'Second queued']);
    } finally {
      await inbox.dispose();
    }
  });
});
