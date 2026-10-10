import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type RunChange } from '@spark-outpost/contracts';
import { addToQueue, listQueue } from '../src/persistence/chat-queue.ts';
import { chatWorktreesOf } from '../src/persistence/chat-worktrees.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { chatTurnWith, runChatTurn } from '../src/workflow/chat-turn.ts';
import type { ChatTurnHooks } from '../src/workflow/chat-turn-hooks.ts';
import { OUTCOME_UNKNOWN_MESSAGE } from '../src/workflow/recovery.ts';
import { runAppender } from '../src/workflow/run-appender.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { expireLeases, untilStatus } from './interruption-support.ts';
import { createTestDb, eventTypes, eventually, type TestDb } from './support.ts';
import {
  cardsOf,
  changesOf,
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  repliesOf,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, startTurnWorker, type TurnWorkerOptions } from './turn-worker.ts';

let t: TestDb;
let root: string;
let worker: Worker | null = null;
let store: string;

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-chat-turn-'));
  await connectAgents(t);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

function start(options: TurnWorkerOptions = {}) {
  worker = startTurnWorker(t, { runTurn: runChatTurn, sessions: store, ...options });
}

async function say(conversationId: string, text: string, permission: 'ask' | 'do' = 'ask') {
  const runId = await sendMessage(t, conversationId, text, { permission });
  const { run } = await driveToEnd(t, conversationId, runId);
  return { run, runId, replies: await repliesOf(t, runId) };
}

function systemAppend(reply: string): string {
  const json = reply.slice(reply.indexOf('session=') + 'session='.length).split('\n')[0]!;
  const report = JSON.parse(json) as { meta: { systemPrompt?: { append?: string } } | null };
  return report.meta?.systemPrompt?.append ?? '';
}

async function childRuns(runId: string): Promise<number> {
  const { rowCount } = await t.db.query('SELECT 1 FROM runs WHERE parent_run_id = $1', [runId]);
  return rowCount ?? 0;
}

describe('a chat turn', { timeout: 60_000 }, () => {
  it('sends the message as typed in a chat with no project: one run, one reply', async () => {
    start();
    const conversationId = await openChat(t);

    const { run, runId, replies } = await say(conversationId, 'What is a monad?');

    expect(run).toMatchObject({ status: 'succeeded', role: null });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('\nWhat is a monad?\n');
    expect(await loadOrchestration(t.db, runId)).toBeNull();
    expect(await childRuns(runId)).toBe(0);
    expect(await cardsOf(t, conversationId)).toEqual([]);
    expect((await eventTypes(t.db, runId)).slice(-2)).toEqual(['TEXT_MESSAGE_END', 'RUN_FINISHED']);
  });

  it('appends the chat prompt after the Working with the user block', async () => {
    start();
    const plain = await say(await openChat(t), 'Report #session');
    const conversationId = await openChat(t, { root });
    const linked = await say(conversationId, 'Report #session', 'do');

    const without = systemAppend(plain.replies[0]!);
    expect(without.indexOf('# Working with the user')).toBe(0);
    expect(without).toContain(
      'You are working for the user in Spark Outpost.\n\nHow to split work',
    );
    expect(without).not.toContain('spark_outpost_draft');
    expect(without).not.toContain('Publishing');
    const [worktree] = await chatWorktreesOf(t.db, conversationId);
    const append = systemAppend(linked.replies[0]!);
    expect(append).toContain(
      `Folder: ${worktree!.path} · Branch: ${worktree!.branch} (a worktree of ${basename(root)})\n`,
    );
    expect(append).toContain('spark_outpost_draft');
    expect(append).toContain(
      "Publishing\n- Don't push or open a pull request unless the user asks.",
    );
  });

  it('reads in the project folder in Codex Read-only: no worktree, no snapshot', async () => {
    start();
    const conversationId = await openChat(t, { root });

    const runId = await sendMessage(t, conversationId, 'Where are you? #cwd', {
      provider: 'codex',
    });
    const { run } = await driveToEnd(t, conversationId, runId);
    const replies = await repliesOf(t, runId);

    expect(run).toMatchObject({ status: 'succeeded', mode: 'ask' });
    expect(replies[0]).toContain(`cwd=${root} `);
    expect(await chatWorktreesOf(t.db, conversationId)).toEqual([]);
    expect(await changesOf(t, runId)).toMatchObject({ revertible: false, files: [] });
    expect(await loadOrchestration(t.db, runId)).toBeNull();
  });

  it('works in the chat’s own worktree and branch in a changing mode', async () => {
    start();
    const conversationId = await openChat(t, { root });
    const first = await say(conversationId, 'Where are you? #cwd', 'do');
    const [worktree] = await chatWorktreesOf(t.db, conversationId);
    expect(worktree).toMatchObject({ repoRoot: root, inPlace: false, ownsBranch: true });
    expect(worktree!.branch).toMatch(/^spark\//);
    expect(first.replies[0]).toContain(`cwd=${worktree!.path} `);

    const file = join(worktree!.path, 'notes.txt');
    const { run, runId } = await say(conversationId, `Edit it #fswrite ${file}`, 'do');

    expect(run.status).toBe('succeeded');
    expect(await readFile(file, 'utf8')).toBe('x');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\n');
    expect(await changesOf(t, runId)).toMatchObject({
      revertible: true,
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
    expect(await chatWorktreesOf(t.db, conversationId)).toHaveLength(1);
    expect(await childRuns(runId)).toBe(0);
    await eventually(async () => {
      const kept = await t.db.query(
        'SELECT 1 FROM task_outcomes WHERE run_id = $1 AND kept IS NOT NULL',
        [runId],
      );
      return kept.rowCount === 1;
    });
    expect(await loadOrchestration(t.db, runId)).toBeNull();
  });

  it('ends a stopped turn as cancelled and keeps what the agent had said', async () => {
    start();
    const conversationId = await openChat(t);
    const runId = await sendMessage(t, conversationId, 'Count #slow');
    await eventually(async () => (await eventTypes(t.db, runId)).includes('TEXT_MESSAGE_CONTENT'));

    await requestCancel(t.db, runId);
    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('cancelled');
    expect((await repliesOf(t, runId))[0]).toMatch(/^word0 /);
  });

  it('writes nothing more once its lease is lost, and recovery ends the run', async () => {
    start();
    const conversationId = await openChat(t);
    const runId = await sendMessage(t, conversationId, 'Count #slow');
    await eventually(async () => (await eventTypes(t.db, runId)).includes('TEXT_MESSAGE_CONTENT'));

    await expireLeases(t, runId);
    const run = await untilStatus(t, runId, 'outcome_unknown');
    await worker!.idle();

    expect(run.error).toBe(OUTCOME_UNKNOWN_MESSAGE);
    expect((await getRun(t.db, runId))?.status).toBe('outcome_unknown');
    const types = await eventTypes(t.db, runId);
    expect(types.filter((type) => type === 'RUN_ERROR')).toHaveLength(1);
    expect(types).not.toContain('RUN_FINISHED');
    expect(await repliesOf(t, runId)).toEqual([]);
  });

  it('sends the next queued message as a turn of its own', async () => {
    start();
    const conversationId = await openChat(t);
    await addToQueue(t.db, conversationId, { id: randomUUID(), content: 'Second' });

    const first = await say(conversationId, 'First');

    const next = await eventually(async () => {
      const detail = await getConversationDetail(t.db, conversationId);
      const run = detail?.runs.find((candidate) => candidate.id !== first.runId);
      return run?.finishedAt ? run : null;
    });
    expect(await listQueue(t.db, conversationId)).toEqual([]);
    expect(next.status).toBe('succeeded');
    expect((await repliesOf(t, next.id))[0]).toContain('prompt=Second');
    expect(await loadOrchestration(t.db, next.id)).toBeNull();
  });

  it('runs the next message directly after a chat was mid-turn at a restart', async () => {
    const conversationId = await openChat(t, { root });
    const interrupted = await sendMessage(t, conversationId, 'Hello');
    const lease = (await claimNextJob(t.db, 30))!;
    const input = { runId: interrupted, threadId: conversationId };
    await runAppender(t.db, lease)(runEvents.started(input), { transition: { status: 'running' } });
    await expireLeases(t, interrupted);

    start();
    const before = await untilStatus(t, interrupted, 'outcome_unknown');
    const { run, replies } = await say(conversationId, 'Are you there?');

    expect(before.error).toBe(OUTCOME_UNKNOWN_MESSAGE);
    expect(run.status).toBe('succeeded');
    expect(replies[0]).toContain('Are you there?');
    expect((await getRun(t.db, interrupted))?.status).toBe('outcome_unknown');
  });

  it('offers the compaction card before a turn in a chat that is almost full', async () => {
    start({
      agentEnv: { FAKE_ACP_COMMANDS: '["compact"]', FAKE_ACP_CONTEXT_SIZE: '200000' },
    });
    await updateProfile(t.db, t.workspaceId, { autoCompact: false });
    const conversationId = await openChat(t);
    await say(conversationId, 'Remember PELICAN');
    await say(conversationId, 'Draft the plan #ctx88');

    const runId = await sendMessage(t, conversationId, 'Next step');
    const { run, asked } = await driveToEnd(t, conversationId, runId, (approval) =>
      approval.kind === 'compact' ? { optionId: CHECKPOINT_OPTION.keepGoing } : null,
    );

    expect(asked.map((card) => card.kind)).toEqual(['compact']);
    expect(run.status).toBe('succeeded');
    expect((await repliesOf(t, runId))[0]).toContain('prompt=Next step');
  });
});

describe('the hooks of a chat turn', { timeout: 60_000 }, () => {
  it('lets the publish step end the reply, then reports kept changes', async () => {
    const calls: string[] = [];
    const kept: RunChange[] = [];
    const hooks: ChatTurnHooks = {
      planTurn: async (_db, input) => {
        calls.push('plan');
        return input;
      },
      changesKept: async (turn, files) => {
        calls.push(`kept:${turn.input.mode}`);
        kept.push(...files);
      },
      publish: async (turn, reply) => {
        calls.push('publish');
        await turn.append(runEvents.textContent(reply.messageId!, '\n\nPublished.'));
        return { ...reply, text: `${reply.text}\n\nPublished.` };
      },
    };
    start({ runTurn: chatTurnWith(hooks) });
    const conversationId = await openChat(t, { root });
    await say(conversationId, 'Where are you? #cwd', 'do');
    const [worktree] = await chatWorktreesOf(t.db, conversationId);
    calls.length = 0;

    const file = join(worktree!.path, 'notes.txt');
    const { run, replies } = await say(conversationId, `Edit it #fswrite ${file}`, 'do');

    expect(run.status).toBe('succeeded');
    expect(calls).toEqual(['plan', 'publish', 'kept:do']);
    expect(kept).toMatchObject([{ path: 'notes.txt', change: 'modified' }]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/\n\nPublished\.$/);
  });

  it('skips kept changes when no file changed and both hooks when the turn was stopped', async () => {
    const calls: string[] = [];
    const hooks: ChatTurnHooks = {
      changesKept: async () => void calls.push('kept'),
      publish: async (_turn, reply) => {
        calls.push('publish');
        return reply;
      },
    };
    start({ runTurn: chatTurnWith(hooks) });
    const conversationId = await openChat(t, { root });

    await say(conversationId, 'Where are you? #cwd', 'do');
    expect(calls).toEqual(['publish']);

    const runId = await sendMessage(t, conversationId, 'Count #slow', { permission: 'do' });
    await eventually(async () => (await eventTypes(t.db, runId)).includes('TEXT_MESSAGE_CONTENT'));
    await requestCancel(t.db, runId);
    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('cancelled');
    expect(calls).toEqual(['publish']);
  });
});
