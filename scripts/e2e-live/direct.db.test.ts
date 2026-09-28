import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EventType } from '../../packages/contracts/src/index.ts';
import {
  createConversation,
  sendUserMessage,
} from '../../apps/server/src/persistence/conversations.ts';
import { claimNextJob, type Lease } from '../../apps/server/src/persistence/jobs.ts';
import { appendRunEvent } from '../../apps/server/src/persistence/run-events.ts';
import { createTestDb, type TestDb } from '../../apps/server/test/support.ts';
import { finishDirectTurn } from './direct.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function startRun(): Promise<Lease> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'hi' },
    { provider: 'fake' },
  );
  const lease = await claimNextJob(t.db, 30);
  if (!lease) throw new Error('No job to claim');
  return lease;
}

async function say(lease: Lease, text: string): Promise<void> {
  const messageId = randomUUID();
  await appendRunEvent(t.db, lease, {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
  });
  await appendRunEvent(t.db, lease, {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: text,
  });
  await appendRunEvent(t.db, lease, { type: EventType.TEXT_MESSAGE_END, messageId });
}

it('scores a direct turn on its final message, not on everything it streamed', async () => {
  const lease = await startRun();
  await say(lease, 'Let me look around first. ');
  await say(lease, 'The final answer.');

  const metrics = await finishDirectTurn(t.db, lease.runId, 1_000, false);

  expect(metrics.reply).toBe('The final answer.');
});
