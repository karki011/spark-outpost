import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Worker } from '../src/workflow/worker.ts';
import {
  keepPlanning,
  planModeSetBeforePrompt,
  plansOf,
  runMode,
  sentToAgent,
} from './chat-plan-support.ts';
import { FAKE_PLAN } from './fake-acp-plans.ts';
import { createTestDb, type TestDb } from './support.ts';
import {
  changesOf,
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  repliesOf,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let worker: Worker;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectAgents(t);
  worker = startTurnWorker(t, {});
  conversationId = await openChat(t, { root });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
});

const MANUAL = { permission: 'do', agentMode: 'default' } as const;
const PLAN_CHAT = { permission: 'ask', agentMode: 'plan' } as const;

const head = () => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString().trim();
const changedFiles = async (runId: string) =>
  (await changesOf(t, runId)).files.map((file) => file.path);

describe('a plan turn of the chat', { timeout: 120_000 }, () => {
  it('/plan starts the agent in its plan mode and its plan approval is the only stop', async () => {
    const runId = await sendMessage(t, conversationId, '/plan Add CSV export #nativeplan', MANUAL);
    const { run, asked } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(await runMode(t, runId)).toBe('do');
    const requests = await sentToAgent(t, runId);
    expect(planModeSetBeforePrompt(requests)).toBe(true);
    const prompt = requests.find((request) => request.method === 'session/prompt')!;
    expect(JSON.stringify(prompt.payload)).not.toContain('/plan');
    expect(asked.map((card) => [card.title, card.payload.plan])).toEqual([
      ['Approve Plan', FAKE_PLAN],
    ]);
    expect(asked[0]!.options.map((option) => option.optionId)).toEqual([
      'exit-plan-clear-auto',
      'exit-plan-auto',
      'exit-plan-default',
      'reject',
    ]);
    expect((await repliesOf(t, runId)).join('\n')).toContain(
      'Plan approved with exit-plan-default. Building it now.',
    );
  });

  it('saves the approved plan with its commit and shows one Plan saved line for the turn', async () => {
    const runId = await sendMessage(t, conversationId, '/plan Add CSV export #nativeplan', MANUAL);
    await driveToEnd(t, conversationId, runId);

    const { documents, lines } = await plansOf(t, conversationId);
    expect(documents).toEqual([
      expect.objectContaining({
        version: 1,
        status: 'approved',
        source: 'claude_plan_mode',
        body: FAKE_PLAN,
        approvedBy: 'user',
        approvedOption: 'exit-plan-default',
        approvedCommit: head(),
        sourceRunId: runId,
      }),
    ]);
    expect(lines).toEqual([expect.objectContaining({ runId, version: 1 })]);
  });

  it('builds the approved plan in the same run, and the files are that run’s changes', async () => {
    const runId = await sendMessage(
      t,
      conversationId,
      '/plan Add CSV export #nativeplan #planbuilds',
      MANUAL,
    );
    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(await changedFiles(runId)).toEqual(['export.ts']);
    const turns = await t.db.query('SELECT id FROM runs WHERE conversation_id = $1', [
      conversationId,
    ]);
    expect(turns.rows).toHaveLength(1);
  });

  it('keeps planning when the plan is not approved: marked rejected, no line, no build', async () => {
    const runId = await sendMessage(
      t,
      conversationId,
      '/plan Add CSV export #nativeplan #planbuilds',
      MANUAL,
    );
    const { run } = await driveToEnd(t, conversationId, runId, keepPlanning);

    expect(run.status).toBe('succeeded');
    expect((await repliesOf(t, runId)).join('\n')).toContain('Kept planning (reject)');
    const { documents, lines } = await plansOf(t, conversationId);
    expect(documents).toEqual([expect.objectContaining({ status: 'rejected', approvedAt: null })]);
    expect(lines).toEqual([]);
    expect(await changedFiles(runId)).toEqual([]);
  });

  for (const trigger of ['#plancallonly', '#planinfile']) {
    it(`takes the plan from the agent's tool call when its request carries none (${trigger})`, async () => {
      const runId = await sendMessage(t, conversationId, `/plan Add CSV export ${trigger}`, MANUAL);
      const { asked } = await driveToEnd(t, conversationId, runId, keepPlanning);

      expect(asked.map((card) => card.payload.plan)).toEqual([FAKE_PLAN]);
      expect((await plansOf(t, conversationId)).documents).toEqual([
        expect.objectContaining({
          status: 'rejected',
          source: 'claude_plan_mode',
          body: FAKE_PLAN,
          sourceRunId: runId,
        }),
      ]);
    });
  }
});

describe('a chat in Plan mode', { timeout: 120_000 }, () => {
  it('answers a question in the agent’s plan mode with no card, no plan and no change', async () => {
    const runId = await sendMessage(t, conversationId, 'What does parseDate do?', PLAN_CHAT);
    const { run, asked } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(asked).toEqual([]);
    expect(planModeSetBeforePrompt(await sentToAgent(t, runId))).toBe(true);
    expect(await repliesOf(t, runId)).toHaveLength(1);
    expect(await plansOf(t, conversationId)).toEqual({ documents: [], lines: [] });
    expect(await changedFiles(runId)).toEqual([]);
  });

  it('gives a build request the same plan turn as /plan, as typed', async () => {
    const runId = await sendMessage(t, conversationId, 'Add CSV export #nativeplan', PLAN_CHAT);
    const { run, asked } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(await runMode(t, runId)).toBe('do');
    expect(asked.map((card) => card.title)).toEqual(['Approve Plan']);
    expect((await repliesOf(t, runId)).join('\n')).toContain('Building it now.');
    expect((await plansOf(t, conversationId)).lines).toEqual([
      expect.objectContaining({ runId, version: 1 }),
    ]);
  });
});

describe('a turn that is not a plan turn', { timeout: 120_000 }, () => {
  it('sends /plan as typed in a chat without a project', async () => {
    const chat = await openChat(t);
    const runId = await sendMessage(t, chat, '/plan Add CSV export');
    const { run, asked } = await driveToEnd(t, chat, runId);

    expect(run.status).toBe('succeeded');
    expect(asked).toEqual([]);
    const requests = await sentToAgent(t, runId);
    expect(planModeSetBeforePrompt(requests)).toBe(false);
    const prompt = requests.find((request) => request.method === 'session/prompt')!;
    expect(JSON.stringify(prompt.payload)).toContain('/plan Add CSV export');
  });

  it('saves a plan Codex proposes in its reply as proposed, with no Plan saved line', async () => {
    const runId = await sendMessage(t, conversationId, 'Plan CSV export #proposedplan', {
      provider: 'codex',
    });
    await driveToEnd(t, conversationId, runId);

    const { documents, lines } = await plansOf(t, conversationId);
    expect(documents).toEqual([
      expect.objectContaining({ status: 'proposed', source: 'codex', body: FAKE_PLAN }),
    ]);
    expect(lines).toEqual([]);
  });
});
