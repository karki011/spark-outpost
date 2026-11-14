import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEAMMATE_BRIEF_HEADER } from '../src/agents/acp/spark-instructions.ts';
import { chatWorktreesOf } from '../src/persistence/chat-worktrees.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { createTeammate } from '../src/persistence/teammates.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { createTestDb, type TestDb } from './support.ts';
import {
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  repliesOf,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const NOTE = 'Instruction file could not be read: it was moved or deleted. Went on without it.';

let t: TestDb;
let root: string;
let store: string;
let worker: Worker;

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-chat-context-'));
  await connectAgents(t);
  worker = startTurnWorker(t, { sessions: store });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function say(conversationId: string, text: string, permission: 'ask' | 'do' = 'ask') {
  const runId = await sendMessage(t, conversationId, text, { permission });
  const { run } = await driveToEnd(t, conversationId, runId);
  expect(run.status).toBe('succeeded');
  return { runId, replies: await repliesOf(t, runId) };
}

async function stepNames(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT payload ->> 'stepName' AS name FROM run_events
     WHERE run_id = $1 AND type = 'STEP_STARTED' ORDER BY seq`,
    [runId],
  );
  return rows.map((row) => row.name);
}

function systemAppend(reply: string): string {
  const json = reply.slice(reply.indexOf('session=') + 'session='.length).split('\n')[0]!;
  const report = JSON.parse(json) as { meta: { systemPrompt?: { append?: string } } | null };
  return report.meta?.systemPrompt?.append ?? '';
}

describe('what a chat turn carries besides the message', { timeout: 120_000 }, () => {
  it('runs without a removed instruction file and notes it once', async () => {
    const file = join(store, 'instructions.md');
    writeFileSync(file, 'Use tests.');
    await updateProfile(t.db, t.workspaceId, { agentInstructionsFile: file });
    unlinkSync(file);

    const { runId } = await say(await openChat(t, { root }), 'Fix the typo. #build', 'do');

    expect((await stepNames(runId)).filter((name) => name === NOTE)).toEqual([NOTE]);
  });

  it('adds a teammate’s standing instructions after the Working with the user block', async () => {
    const teammate = await createTeammate(t.db, t.workspaceId, {
      name: 'Pip',
      role: 'Code reviewer',
      provider: null,
      model: null,
      effort: null,
      agentMode: null,
      level: null,
      instructions: 'Always name the file and line you mean.',
      projectIds: [],
    });
    const conversationId = await openChat(t, { root });
    await t.db.query('UPDATE conversations SET teammate_id = $2 WHERE id = $1', [
      conversationId,
      teammate.id,
    ]);

    const { replies } = await say(conversationId, 'What does parseDate do? #session');

    const append = systemAppend(replies[0]!);
    expect(append).toContain(`${TEAMMATE_BRIEF_HEADER} for the Spark teammate Pip (Code reviewer)`);
    expect(append).toContain("Follow it as you would the user's own message");
    expect(append).toContain('Always name the file and line you mean.');
    expect(append.indexOf('# Working with the user')).toBeLessThan(
      append.indexOf(TEAMMATE_BRIEF_HEADER),
    );
  });

  it('does not call the chat’s own worktree a changed project on the next turn', async () => {
    const conversationId = await openChat(t, { root });
    const first = await say(conversationId, 'Add a line to notes.txt #build', 'do');
    const second = await say(conversationId, 'Add another line to notes.txt #build', 'do');

    const [worktree] = await chatWorktreesOf(t.db, conversationId);
    expect(worktree!.path).toContain(`${root}/.spark/worktrees/`);
    await expectConformantRun(t.db, first.runId);
    await expectConformantRun(t.db, second.runId);
    expect(
      (await stepNames(second.runId)).filter((step) => step.startsWith('Project changed')),
    ).toEqual([]);
    expect(second.replies.join('\n')).not.toContain('project folder changed');
  });
});
