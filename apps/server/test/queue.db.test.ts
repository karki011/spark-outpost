import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import {
  claimMemberMessages,
  getMemberMessage,
  insertMemberMessage,
} from '../src/persistence/member-messages.ts';
import { LeaseLostError, appendRunEvent } from '../src/persistence/run-events.ts';
import { getRun } from '../src/persistence/runs.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { createTestDb, eventTypes, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function queueRuns(count: number): Promise<string[]> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const runIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const sent = await sendUserMessage(
      t.db,
      conversation.id,
      { id: randomUUID(), content: `message ${index}` },
      { provider: 'fake' },
    );
    runIds.push(sent.run.id);
  }
  return runIds;
}

async function expireLease(jobId: string) {
  await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [
    jobId,
  ]);
}

describe('job queue', () => {
  it('never hands the same job to concurrent claimers', async () => {
    await queueRuns(5);
    const leases = await Promise.all(Array.from({ length: 8 }, () => claimNextJob(t.db, 30)));
    const claimed = leases.filter((lease) => lease !== null).map((lease) => lease.jobId);
    expect(claimed).toHaveLength(5);
    expect(new Set(claimed).size).toBe(5);
  });

  it('stops a worker from appending after its lease expires', async () => {
    const [runId] = await queueRuns(1);
    const lease = (await claimNextJob(t.db, 30))!;
    await appendRunEvent(t.db, lease, runEvents.started({ runId: runId!, threadId: 'thread' }));
    await expireLease(lease.jobId);

    await expect(appendRunEvent(t.db, lease, runEvents.stepStarted('late'))).rejects.toBeInstanceOf(
      LeaseLostError,
    );
    expect(await eventTypes(t.db, runId!)).toEqual(['RUN_STARTED']);
  });

  it('marks an expired run as outcome unknown without retrying it', async () => {
    const [runId] = await queueRuns(1);
    const lease = (await claimNextJob(t.db, 30))!;
    await expireLease(lease.jobId);

    expect(await recoverExpiredLeases(t.db)).toBe(1);

    expect((await getRun(t.db, runId!))?.status).toBe('outcome_unknown');
    expect(await eventTypes(t.db, runId!)).toEqual(['RUN_STARTED', 'RUN_ERROR']);
    await expectConformantRun(t.db, runId!);
    expect(await claimNextJob(t.db, 30)).toBeNull();
    await expect(appendRunEvent(t.db, lease, runEvents.stepStarted('late'))).rejects.toBeInstanceOf(
      LeaseLostError,
    );
  });

  it('ends a run that crashed mid-step with one error the stream check accepts', async () => {
    const [runId] = await queueRuns(1);
    const lease = (await claimNextJob(t.db, 30))!;
    await appendRunEvent(t.db, lease, runEvents.started({ runId: runId!, threadId: 'thread' }));
    await appendRunEvent(t.db, lease, runEvents.stepStarted('Running tests'));
    await appendRunEvent(t.db, lease, runEvents.toolCallStart('call-1', 'Running tests'));
    await expireLease(lease.jobId);

    expect(await recoverExpiredLeases(t.db)).toBe(1);
    expect(await recoverExpiredLeases(t.db)).toBe(0);

    expect((await eventTypes(t.db, runId!)).slice(-2)).toEqual(['TOOL_CALL_START', 'RUN_ERROR']);
    await expectConformantRun(t.db, runId!);
  });

  it('marks a message taken from the inbox but never acted on as missed after a crash', async () => {
    const [runId] = await queueRuns(1);
    const lease = (await claimNextJob(t.db, 30))!;
    await appendRunEvent(t.db, lease, runEvents.started({ runId: runId!, threadId: 'thread' }));
    const { rows } = await t.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM runs WHERE id = $1',
      [runId],
    );
    const conversationId = rows[0]!.conversation_id;
    const steer = async () => {
      const id = randomUUID();
      await insertMemberMessage(t.db, {
        id,
        conversationId,
        runId: runId!,
        body: 'Now',
        urgency: 'now',
      });
      await claimMemberMessages(t.db, runId!, runId!, true);
      return id;
    };
    const acted = await steer();
    await appendRunEvent(t.db, lease, runEvents.stepStarted('Acting on it'));
    const unread = await steer();
    await expireLease(lease.jobId);

    expect(await recoverExpiredLeases(t.db)).toBe(1);

    expect((await getMemberMessage(t.db, acted))?.status).toBe('delivered');
    expect((await getMemberMessage(t.db, unread))?.status).toBe('missed');
  });
});
