import { randomUUID } from 'node:crypto';
import { EventType, SUBAGENTS_ACTIVITY } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue, listQueue } from '../src/persistence/chat-queue.ts';
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

async function waitingTurn() {
  const chat = await startChat(t, 'Work');
  const lease = (await claimNextJob(t.db, 30))!;
  await appendRunEvent(
    t.db,
    lease,
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: SUBAGENTS_ACTIVITY,
      activityType: SUBAGENTS_ACTIVITY,
      content: { waitingOn: 1 },
      replace: true,
    },
    { transition: { status: 'running' } },
  );
  return chat;
}

async function queued(conversationId: string, content: string) {
  const id = randomUUID();
  await addToQueue(t.db, conversationId, { id, content });
  return id;
}

const contents = async (conversationId: string) =>
  (await listQueue(t.db, conversationId)).map((item) => item.content);

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
