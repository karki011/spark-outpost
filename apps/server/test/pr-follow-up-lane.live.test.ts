import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cliSignedIn } from '../src/agents/acp/agent-cli.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { roundResumeKey, startRoundWith } from '../src/pr-follow-up/deps.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { sendNow } from '../src/workflow/queue-drain.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const TARGET = { provider: 'claude', model: 'haiku' };
const TURN_TIMEOUT_MS = 180_000;
const LONG_ROUND =
  'This is a slow background job. Write the numbers 1 to 400, one per line, with nothing else, then write ROUND-DONE on the last line.';
const claudeReady = (await cliSignedIn('claude')) === true;

let t: TestDb;
let worker: Worker | null = null;
const conversationId = randomUUID();
const watchId = randomUUID();

interface RunFacts {
  status: string;
  reply: string;
  created: Date;
  finished: Date | null;
}

async function runFacts(runId: string): Promise<RunFacts> {
  const { rows } = await t.db.query<RunFacts>(
    `SELECT r.status, r.created_at AS created, r.finished_at AS finished,
       COALESCE((SELECT string_agg(m.content, E'\\n' ORDER BY m.created_at) FROM messages m
                 WHERE m.run_id = r.id AND m.role = 'assistant'), '') AS reply
     FROM runs r WHERE r.id = $1`,
    [runId],
  );
  return rows[0]!;
}

async function settled(runId: string): Promise<RunFacts> {
  await eventually(
    async () =>
      !['queued', 'running', 'awaiting_approval'].includes((await runFacts(runId)).status),
    TURN_TIMEOUT_MS,
  );
  return runFacts(runId);
}

async function runOf(messageId: string): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>(
    'SELECT id FROM runs WHERE user_message_id = $1 AND parent_run_id IS NULL',
    [messageId],
  );
  return rows[0]!.id;
}

async function ask(content: string): Promise<string> {
  const id = randomUUID();
  const outcome = await sendNow(t.db, conversationId, { id, content }, async () => TARGET);
  expect(outcome).toBe('sent');
  return runOf(id);
}

beforeAll(async () => {
  if (!claudeReady) return;
  t = await createTestDb();
  await saveConnection(t.db, t.workspaceId, 'claude', {
    method: 'cli',
    detail: 'live',
    summary: '',
    models: [],
  });
  worker = startWorker({
    db: t.db,
    providers: createProviders('acp'),
    leaseSeconds: 30,
    pollMs: 100,
    approvalPollMs: 200,
  });
});

afterAll(async () => {
  if (!claudeReady) return;
  await worker?.stop();
  await t.cleanup();
});

describe.skipIf(!claudeReady)('a follow-up round beside the chat, with real Claude', () => {
  it('answers the user on the chat session while the round runs on its own, and survives a stop', async () => {
    const first = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'Remember this codeword: HERON-42. Reply with OK only.' },
      TARGET,
      t.workspaceId,
    );
    expect((await settled(first.run.id)).status).toBe('succeeded');

    const roundId = await startRoundWith(t.db, { id: watchId, conversationId }, LONG_ROUND, TARGET);
    await eventually(async () => (await runFacts(roundId)).status === 'running', 60_000);
    const questionId = await ask('What was the codeword? Reply with the codeword only.');
    const question = await settled(questionId);
    const round = await settled(roundId);
    console.log('round beside chat', {
      question: { status: question.status, reply: question.reply.slice(0, 80) },
      round: { status: round.status, tail: round.reply.slice(-40) },
      overlapped: question.created < (round.finished ?? new Date()),
    });
    expect(question.status).toBe('succeeded');
    expect(question.reply).toContain('HERON-42');
    expect(round.status).toBe('succeeded');
    expect(round.reply).toContain('ROUND-DONE');
    expect(question.created.getTime()).toBeLessThan(round.finished!.getTime());

    const sessions = await t.db.query<{ agent_key: string }>(
      'SELECT DISTINCT agent_key FROM provider_sessions WHERE conversation_id = $1 ORDER BY 1',
      [conversationId],
    );
    expect(sessions.rows.map((row) => row.agent_key)).toEqual([
      'chat:claude',
      `key:${roundResumeKey(watchId)}`,
    ]);

    const second = await startRoundWith(t.db, { id: watchId, conversationId }, LONG_ROUND, TARGET);
    await eventually(async () => (await runFacts(second)).status === 'running', 60_000);
    await stopRun(t.db, second);
    expect((await settled(second)).status).toBe('cancelled');
    const after = await settled(await ask('Say the codeword once more, the codeword only.'));
    expect(after.status).toBe('succeeded');
    expect(after.reply).toContain('HERON-42');
  }, 600_000);
});
