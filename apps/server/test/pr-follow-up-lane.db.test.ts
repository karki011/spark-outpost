import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { urgentLeftovers } from '../src/persistence/member-messages.ts';
import { roundResumeKey, startRoundWith } from '../src/pr-follow-up/deps.ts';
import { MAIN_AGENT_NOTE } from '../src/pr-follow-up/prompt.ts';
import { drainQueue, sendNow } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { openPull, startFakeWorker, type OpenPull } from './pr-follow-up-support.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let pull: OpenPull;
let roundRunId: string;
let tools: SparkToolsHarness | null = null;
const target = async () => ({ provider: 'fake' });

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-follow-up-lane-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async (context) => {
  t = await createTestDb();
  const worker = startFakeWorker(t);
  pull = await openPull(t, base, context.task.id);
  await worker.stop();
  roundRunId = await startRoundWith(t.db, pull.watch, 'Round 1', { provider: 'fake' });
  await t.db.query(
    "UPDATE pr_watches SET phase = 'fixing', round_run_id = $2, rounds = 1 WHERE id = $1",
    [pull.watch.id, roundRunId],
  );
});

afterEach(async () => {
  await tools?.close();
  tools = null;
  await t.cleanup();
});

async function chatRunFor(messageId: string) {
  const { rows } = await t.db.query<{ id: string; source: string | null }>(
    'SELECT id, source FROM runs WHERE user_message_id = $1 AND parent_run_id IS NULL',
    [messageId],
  );
  return rows[0] ?? null;
}

async function mainAgentTools(): Promise<SparkToolsHarness> {
  const { rows } = await t.db.query<{ id: string }>(
    'SELECT id FROM runs WHERE conversation_id = $1 AND id <> $2 LIMIT 1',
    [pull.conversationId, roundRunId],
  );
  tools = await startSparkTools(t, { conversationId: pull.conversationId, runId: rows[0]!.id });
  return tools;
}

describe('a follow-up round outside the chat’s turns', { timeout: 60_000 }, () => {
  it('runs on its own session key, not the chat’s session', async () => {
    const input = await loadRunInput(t.db, roundRunId);
    expect(input.followUpLane).toBe(true);
    expect(input.followUpRound).toBe(true);
    expect(input.resumeKey).toBe(roundResumeKey(pull.watch.id));
  });

  it('starts a message sent now as its own turn instead of steering the round', async () => {
    const id = randomUUID();
    const outcome = await sendNow(t.db, pull.conversationId, { id, content: 'A question' }, target);
    expect(outcome).toBe('sent');
    expect((await chatRunFor(id))?.id).not.toBe(roundRunId);
    const steered = await t.db.query('SELECT 1 FROM member_messages WHERE run_id = $1', [
      roundRunId,
    ]);
    expect(steered.rowCount).toBe(0);
  });

  it('drains a queued message while the round runs', async () => {
    const id = randomUUID();
    await addToQueue(t.db, pull.conversationId, { id, content: 'Queued' });
    expect(await drainQueue(t.db, pull.conversationId, target)).toBe('sent');
    expect(await chatRunFor(id)).not.toBeNull();
  });

  it('lets the chat’s agent message the round, then stop it', async () => {
    const main = await mainAgentTools();
    const sent = await main.call('spark_pr_follow_up_round', {
      action: 'message',
      message: 'Wait, we are changing notes.txt.',
    });
    expect(sent.isError).toBe(false);
    const { rows } = await t.db.query<{ body: string; urgency: string }>(
      'SELECT body, urgency FROM member_messages WHERE run_id = $1',
      [roundRunId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.urgency).toBe('now');
    expect(rows[0]!.body).toBe(`${MAIN_AGENT_NOTE}\nWait, we are changing notes.txt.`);

    const stopped = await main.call('spark_pr_follow_up_round', { action: 'stop' });
    expect(stopped.isError).toBe(false);
    const run = await t.db.query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [
      roundRunId,
    ]);
    expect(run.rows[0]!.status).toBe('cancelled');
    expect(await urgentLeftovers(t.db, pull.conversationId)).toEqual([]);
  });

  it('refuses to stop or message when no round is running', async () => {
    await t.db.query(
      "UPDATE pr_watches SET phase = 'watching', round_run_id = NULL WHERE id = $1",
      [pull.watch.id],
    );
    const main = await mainAgentTools();
    expect((await main.call('spark_pr_follow_up_round', { action: 'stop' })).isError).toBe(true);
    const message = await main.call('spark_pr_follow_up_round', {
      action: 'message',
      message: 'x',
    });
    expect(message.isError).toBe(true);
  });
});
