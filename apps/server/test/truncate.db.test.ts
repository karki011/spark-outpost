import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import type { DbClient } from '../src/persistence/db.ts';
import { insertOrchestration } from '../src/persistence/orchestrations.ts';
import { truncateTables } from '../src/persistence/truncate.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await t.cleanup();
});

const RESET_TABLES = ['jobs', 'run_events', 'messages', 'runs', 'conversations'];
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seedRun(): Promise<string> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Hello' },
    { provider: 'fake' },
  );
  await insertOrchestration(t.db, {
    runId: sent.run.id,
    depth: 'direct',
    depthSource: 'rules',
    risk: 'read-only',
  });
  return sent.run.id;
}

async function readerHoldingOrchestrations(runId: string): Promise<DbClient> {
  const reader = await t.db.connect();
  await reader.query('BEGIN');
  await reader.query('SELECT run_id FROM orchestrations WHERE run_id = $1', [runId]);
  return reader;
}

async function readRuns(reader: DbClient, runId: string): Promise<unknown> {
  try {
    await reader.query('SELECT id FROM runs WHERE id = $1', [runId]);
    await reader.query('COMMIT');
    return null;
  } catch (error) {
    await reader.query('ROLLBACK');
    return error;
  } finally {
    reader.release();
  }
}

describe('resetting tables under a live orchestration', () => {
  it('reproduces the deadlock with a plain TRUNCATE that locks runs before orchestrations', async () => {
    const runId = await seedRun();
    const reader = await readerHoldingOrchestrations(runId);
    const truncating = t.db.connect().then(async (client) => {
      try {
        await client.query(`TRUNCATE ${RESET_TABLES.join(', ')} CASCADE`);
        return null;
      } catch (error) {
        return error;
      } finally {
        client.release();
      }
    });
    await settle(150);
    const outcomes = await Promise.all([readRuns(reader, runId), truncating]);
    expect(outcomes).toContainEqual(expect.objectContaining({ code: '40P01' }));
  });

  it('truncates without deadlocking a reader that locks orchestrations then runs', async () => {
    const runId = await seedRun();
    const reader = await readerHoldingOrchestrations(runId);
    const truncating = truncateTables(t.db, RESET_TABLES);
    await settle(150);
    expect(await readRuns(reader, runId)).toBeNull();
    await truncating;
    const { rows } = await t.db.query('SELECT 1 FROM runs UNION ALL SELECT 1 FROM orchestrations');
    expect(rows).toEqual([]);
  });

  it('retries a statement that loses a deadlock once instead of failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runId = await seedRun();
    const blocker = await t.db.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE runs IN ACCESS EXCLUSIVE MODE');
      const joined = t.db.query<{ run_id: string }>(
        'SELECT o.run_id FROM orchestrations o JOIN runs r ON r.id = o.run_id WHERE o.run_id = $1',
        [runId],
      );
      await settle(150);
      await blocker.query('LOCK TABLE orchestrations IN ACCESS EXCLUSIVE MODE');
      await blocker.query('COMMIT');
      const { rows } = await joined;
      expect(rows).toEqual([{ run_id: runId }]);
      expect(warn).toHaveBeenCalledWith('Database deadlock; retrying once.');
    } finally {
      blocker.release();
    }
  });
});
