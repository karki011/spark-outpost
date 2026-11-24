import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { withTransaction } from '../src/persistence/db.ts';
import { claimNextJob, type Lease } from '../src/persistence/jobs.ts';
import { LeaseLostError, appendRunEvents, insertRunEvent } from '../src/persistence/run-events.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function leased(): Promise<Lease> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Hello' },
    { provider: 'nobody' },
  );
  return (await claimNextJob(t.db, 30))!;
}

async function seqs(runId: string): Promise<number[]> {
  const { rows } = await t.db.query<{ seq: number }>(
    'SELECT seq FROM run_events WHERE run_id = $1 ORDER BY seq',
    [runId],
  );
  return rows.map((row) => row.seq);
}

async function deltas(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ delta: string }>(
    `SELECT payload->>'delta' AS delta FROM run_events WHERE run_id = $1 ORDER BY seq`,
    [runId],
  );
  return rows.map((row) => row.delta);
}

async function appendIsWaitingForTheJob(): Promise<boolean> {
  const { rows } = await t.db.query<{ waiting: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query LIKE 'WITH held AS%'
     ) AS waiting`,
  );
  return rows[0]!.waiting;
}

const text = (delta: string) => runEvents.textContent('message-1', delta);

describe('appending events without other writes', () => {
  it('numbers a batch after the last stored event and returns its last seq', async () => {
    const lease = await leased();
    expect(await appendRunEvents(t.db, lease, [text('a'), text('b')])).toBe(2);
    expect(await appendRunEvents(t.db, lease, [text('c')])).toBe(3);
    expect(await appendRunEvents(t.db, lease, [text('d'), text('e'), text('f')])).toBe(6);
    expect(await seqs(lease.runId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await deltas(lease.runId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('gives concurrent appends on one lease distinct, gapless seqs', async () => {
    const lease = await leased();
    const last = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        appendRunEvents(t.db, lease, [text(`${index}a`), text(`${index}b`)]),
      ),
    );
    expect([...last].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, index) => (index + 1) * 2),
    );
    expect(await seqs(lease.runId)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    const stored = await deltas(lease.runId);
    for (let index = 0; index < stored.length; index += 2) {
      expect(stored[index + 1]).toBe(stored[index]!.replace('a', 'b'));
    }
  });

  it('appends after a writer that holds the job row adds its own event', async () => {
    const lease = await leased();
    await appendRunEvents(t.db, lease, [text('first')]);
    let appended: Promise<number> | null = null;
    await withTransaction(t.db, async (client) => {
      await client.query('SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE', [lease.jobId]);
      appended = appendRunEvents(t.db, lease, [text('third')]);
      await eventually(appendIsWaitingForTheJob);
      await insertRunEvent(client, lease.runId, text('second'));
    });
    expect(await appended!).toBe(3);
    expect(await deltas(lease.runId)).toEqual(['first', 'second', 'third']);
  });

  it('rejects a stale writer and stores nothing', async () => {
    const lease = await leased();
    const stale = { ...lease, token: randomUUID() };
    await expect(appendRunEvents(t.db, stale, [text('late')])).rejects.toBeInstanceOf(
      LeaseLostError,
    );
    expect(await seqs(lease.runId)).toEqual([]);
  });

  it('rejects an expired lease unless the writer expects it expired', async () => {
    const lease = await leased();
    await expect(
      appendRunEvents(t.db, lease, [text('early')], { expectExpired: true }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    await expect(appendRunEvents(t.db, lease, [text('late')])).rejects.toBeInstanceOf(
      LeaseLostError,
    );
    expect(await appendRunEvents(t.db, lease, [text('swept')], { expectExpired: true })).toBe(1);
    expect(await deltas(lease.runId)).toEqual(['swept']);
  });

  it('notifies run_events once per stored batch and never for a stale writer', async () => {
    const lease = await leased();
    const listener = await t.db.connect();
    let heard = 0;
    try {
      listener.on('notification', (message) => {
        if (message.payload === lease.runId) heard += 1;
      });
      await listener.query('LISTEN run_events');
      await appendRunEvents(t.db, lease, [text('a'), text('b')]);
      await eventually(async () => heard === 1);
      await expect(
        appendRunEvents(t.db, { ...lease, token: randomUUID() }, [text('c')]),
      ).rejects.toBeInstanceOf(LeaseLostError);
      await appendRunEvents(t.db, lease, [text('d')]);
      await eventually(async () => heard >= 2);
      expect(heard).toBe(2);
    } finally {
      listener.removeAllListeners('notification');
      await listener.query('UNLISTEN run_events');
      listener.release();
    }
  });
});
