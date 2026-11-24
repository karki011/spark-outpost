import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cliSignedIn } from '../src/agents/acp/agent-cli.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { roundResumeKey, startRoundWith } from '../src/pr-follow-up/deps.ts';
import { createProject } from '../src/projects/projects.ts';
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

describe.skipIf(!claudeReady)('the agent sessions of one chat, with real Claude', () => {
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

  it('serves a later turn on the model the chat switched to, not the one its process started on', async () => {
    const chat = randomUUID();
    const usedModel = async (runId: string) => {
      const { rows } = await t.db.query<{ used_model: string | null }>(
        'SELECT used_model FROM runs WHERE id = $1',
        [runId],
      );
      return rows[0]?.used_model ?? '';
    };
    const first = await sendUserMessage(
      t.db,
      chat,
      { id: randomUUID(), content: 'Reply with OK only.' },
      { provider: 'claude', model: 'haiku' },
      t.workspaceId,
    );
    expect((await settled(first.run.id)).status).toBe('succeeded');
    const second = await sendUserMessage(
      t.db,
      chat,
      { id: randomUUID(), content: 'Reply with OK only, again.' },
      { provider: 'claude', model: 'sonnet' },
    );
    expect((await settled(second.run.id)).status).toBe('succeeded');
    const models = [await usedModel(first.run.id), await usedModel(second.run.id)];
    console.log('models served', models);
    const sessions = await t.db.query(
      'SELECT 1 FROM provider_sessions WHERE conversation_id = $1',
      [chat],
    );
    expect(sessions.rowCount).toBe(1);
    expect(models[0]).toContain('haiku');
    expect(models[1]).toContain('sonnet');
  }, 300_000);

  it('moves a long command to the background and tells the agent when it ends', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'spark-live-command-')));
    const repo = join(base, 'repo');
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(join(repo, 'README.md'), '# Live command probe\n');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', [
      '-C',
      repo,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-qm',
      'base',
    ]);
    const projectId = (await createProject(t.db, t.workspaceId, repo)).project.id;
    const chat = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
    await setConversationProjects(t.db, t.workspaceId, chat, [projectId]);
    const sent = await sendUserMessage(
      t.db,
      chat,
      {
        id: randomUUID(),
        content:
          'Run this with your shell tool as an ordinary foreground call: python3 -c "import time; time.sleep(40); print(\'SLEPT-OK\')". If it is moved to the background, wait for its completion notice, then read its output file. Reply with the word the command printed.',
      },
      { ...TARGET, permission: 'do', level: 'hands-off', agentMode: 'bypassPermissions' },
      t.workspaceId,
    );
    const run = await settled(sent.run.id);
    const moved = await t.db.query(
      `SELECT 1 FROM run_protocol_log WHERE run_id = $1
           AND payload::text LIKE '%moved to the background%' LIMIT 1`,
      [sent.run.id],
    );
    const seconds = (run.finished!.getTime() - run.created.getTime()) / 1000;
    console.log('long command', { seconds, reply: run.reply.slice(-200) });
    expect(run.status).toBe('succeeded');
    expect(moved.rowCount).toBe(1);
    expect(run.reply).toContain('SLEPT-OK');
    expect(seconds).toBeGreaterThan(40);
  }, 300_000);
});
