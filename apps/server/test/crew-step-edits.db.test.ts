import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EDITS_OFF_NOTE } from '../src/crew-flows/step-edits.ts';
import { PLACE_HEADER } from '../src/crew-flows/step-place.ts';
import { startWorkflowRun } from '../src/crew-flows/start-run.ts';
import { replyText } from '../src/persistence/spark-mentions.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { at, schedulerClock } from './crew-schedule-support.ts';
import { newSpark, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import {
  CHAT_BRANCH,
  chatOnItsBranch,
  promptsOf,
  type BranchChat,
} from './publish-step-support.ts';
import { git, write } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { changesOf, driveToEnd, openChat, repliesOf } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const FLOW = 'fixer';

let t: TestDb;
let base: string;
let worker: Worker;
let chats = 0;
let dropWorkflows: () => Promise<void>;
let sparkId: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-step-edits-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  await connectAgents(t);
  dropWorkflows = await useWorkflowsDir();
  sparkId = (await newSpark(t, 'Pip')).id;
  chats += 1;
  worker = startTurnWorker(t, { sessions: path.join(base, `sessions-${chats}`) });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await dropWorkflows();
});

async function triggered(conversationId: string, edits: boolean) {
  const run = await startWorkflowRun(schedulerClock(t, at(9, 0)).deps, {
    kind: 'run',
    workflowId: FLOW,
    messageId: randomUUID(),
    source: 'trigger',
    conversationId,
    projectId: null,
    message: 'Fix what you find.',
    trigger: { kind: 'turn_changed', diffHash: null },
    edits,
  });
  await driveToEnd(t, conversationId, run.runId!);
  return run;
}

async function stepSaid(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>(
    'SELECT id FROM runs WHERE parent_run_id = $1',
    [runId],
  );
  return replyText(t.db, rows[0]!.id);
}

const notes = (chat: BranchChat) => readFile(path.join(chat.repo.root, 'notes.txt'), 'utf8');

describe('a triggered run that may change files', { timeout: 120_000 }, () => {
  it('lets its step edit the chat’s worktree, leaves it uncommitted and keeps a record', async () => {
    const chat = await chatOnItsBranch(t, base, `edits-${chats}`, 'hands-off', 'none');
    const target = path.join(chat.repo.root, 'notes.txt');
    await saveFlow(t, FLOW, [step('fix', sparkId, { prompt: `Fix it. #fswrite ${target}` })]);
    const head = git(chat.repo.root, 'rev-parse', 'HEAD');

    const run = await triggered(chat.conversationId, true);

    expect(await stepSaid(run.runId!)).toContain('=ok:');
    expect(await notes(chat)).toBe('x');
    expect(git(chat.repo.root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(chat.repo.root, 'status', '--porcelain')).toContain('notes.txt');
    expect((await changesOf(t, run.runId!)).files).toEqual([
      { path: 'notes.txt', change: 'modified' },
    ]);
    const [report] = await repliesOf(t, run.runId!);
    expect(report).toContain('handed to you, the chat’s main agent');
    expect(report).toContain('fix (Pip');
    expect(report).not.toContain('If the user’s message asks');
  });

  it('never publishes from the turn, even when the chat is at Full auto → PR', async () => {
    const chat = await chatOnItsBranch(t, base, `edits-${chats}`, 'full-auto', 'none');
    const target = path.join(chat.repo.root, 'notes.txt');
    await saveFlow(t, FLOW, [step('fix', sparkId, { prompt: `Fix it. #fswrite ${target}` })]);
    const head = git(chat.repo.root, 'rev-parse', 'HEAD');

    const run = await triggered(chat.conversationId, true);

    expect(await notes(chat)).toBe('x');
    expect(git(chat.repo.root, 'rev-parse', 'HEAD')).toBe(head);
    expect(await promptsOf(t, run.runId!)).toBe(1);
    const [report] = await repliesOf(t, run.runId!);
    expect(report).toContain('This turn does not push or open a pull request');
  });

  it('keeps the step read-only without the option', async () => {
    const chat = await chatOnItsBranch(t, base, `edits-${chats}`, 'hands-off', 'none');
    const target = path.join(chat.repo.root, 'notes.txt');
    await saveFlow(t, FLOW, [step('fix', sparkId, { prompt: `Fix it. #fswrite ${target}` })]);
    const before = await notes(chat);

    const run = await triggered(chat.conversationId, false);

    expect(await stepSaid(run.runId!)).toContain('=err:');
    expect(await notes(chat)).toBe(before);
  });

  it('turns edits off in a chat with no worktree of its own, so your checkout is never changed', async () => {
    const repo = await chatOnItsBranch(t, base, `edits-${chats}`, 'hands-off', 'none');
    const conversationId = await openChat(t, { root: repo.repo.root });
    const target = path.join(repo.repo.root, 'notes.txt');
    await saveFlow(t, FLOW, [step('fix', sparkId, { prompt: `Fix it. #fswrite ${target}` })]);
    const before = await notes(repo);

    const run = await triggered(conversationId, true);

    expect(await notes(repo)).toBe(before);
    const { rows } = await t.db.query<{ edits: boolean }>(
      'SELECT edits FROM workflow_runs WHERE id = $1',
      [run.id],
    );
    expect(rows[0]!.edits).toBe(false);
    const steps = await t.db.query<{ name: string }>(
      `SELECT payload->>'stepName' AS name FROM run_events WHERE run_id = $1`,
      [run.runId],
    );
    expect(steps.rows.map((row) => row.name)).toContain(EDITS_OFF_NOTE);
  });
});

describe('a triggered run’s step prompt', { timeout: 120_000 }, () => {
  it('says where the step is: repo, branch, base and the branch’s changed files', async () => {
    const chat = await chatOnItsBranch(t, base, `place-${chats}`, 'hands-off');
    await write(chat.repo.root, 'dates.ts', 'export const x = 1;\n');
    git(chat.repo.root, 'add', 'dates.ts');
    git(chat.repo.root, 'commit', '-qm', 'Add dates');
    await write(chat.repo.root, 'notes.txt', 'changed\n');
    await saveFlow(t, FLOW, [step('look', sparkId, { prompt: 'Review the branch.' })]);

    const run = await triggered(chat.conversationId, false);

    const { rows } = await t.db.query<{ prompt: string }>(
      'SELECT prompt FROM runs WHERE parent_run_id = $1',
      [run.runId],
    );
    const prompt = rows[0]!.prompt;
    expect(prompt).toContain(PLACE_HEADER);
    expect(prompt).toContain('Started by: a turn in this chat that kept changes (a trigger).');
    expect(prompt).toContain('Project: acme/widgets');
    expect(prompt).toContain(`Branch: ${CHAT_BRANCH}, compared with main`);
    expect(prompt).toContain('- dates.ts (+1 -0)');
    expect(prompt).toContain('- notes.txt (+1 -1)');
    expect(prompt).not.toContain(chat.repo.root);
  });
});
