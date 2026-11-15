import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workflowTriggersSchema, type WorkflowTriggers } from '@spark-outpost/contracts';
import { listHolds, releaseHold } from '../src/crew-flows/publish-holds.ts';
import { listWorkflowRuns, settleStrandedRuns } from '../src/crew-flows/run-records.ts';
import { saveTriggers } from '../src/crew-flows/trigger-records.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { GATE_STOPPED_LINE } from '../src/workflow/publish-step.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { newSpark, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import {
  CHAT_BRANCH,
  chatOnItsBranch,
  promptsOf,
  shipAccessTo,
  type BranchChat,
} from './publish-step-support.ts';
import { git, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { driveToEnd, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';
const FLOW = 'gate';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let worker: Worker;
let chats = 0;
let dropWorkflows: () => Promise<void>;
let sparkId: string;

const ghState = () => path.join(base, 'gh-state');

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-gate-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = ghState();
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await writeFile(ghState(), 'octo-cli');
  await connectAgents(t);
  dropWorkflows = await useWorkflowsDir();
  sparkId = (await newSpark(t, 'Pip')).id;
  chats += 1;
  worker = startTurnWorker(t, {
    shipAccess: shipAccessTo(stub.url),
    sessions: path.join(base, `sessions-${chats}`),
  });
});

afterEach(async () => {
  await worker.stop();
  await stub.close();
  await t.cleanup();
  await dropWorkflows();
});

async function gate(stepPrompt: string, extra: Partial<WorkflowTriggers> = {}) {
  await saveFlow(t, FLOW, [step('review', sparkId, { prompt: stepPrompt })]);
  await saveTriggers(
    t.db,
    t.workspaceId,
    FLOW,
    workflowTriggersSchema.parse({ beforePublish: true, ...extra }),
  );
}

async function turn(chat: BranchChat, text: string) {
  const runId = await sendMessage(t, chat.conversationId, text, {
    permission: 'do',
    level: 'full-auto',
  });
  const { run } = await driveToEnd(t, chat.conversationId, runId);
  return { runId, run, replies: await repliesOf(t, runId), prompts: await promptsOf(t, runId) };
}

const onRemote = (chat: BranchChat) => git(chat.repo.bare, 'branch', '--list', CHAT_BRANCH) !== '';
const gateRuns = () => listWorkflowRuns(t.db, t.workspaceId, FLOW);

describe('a workflow that runs before publish', { timeout: 120_000 }, () => {
  it('reviews the branch first, then publishes when nothing blocks', async () => {
    await gate('Review the change.', { holdOnFindings: true });
    const chat = await chatOnItsBranch(t, base, `gate-${chats}`, 'full-auto');

    const { runId, prompts } = await turn(chat, BUILD);

    expect(prompts).toBe(2);
    expect(stub.github.pulls).toHaveLength(1);
    const [review] = await gateRuns();
    expect(review).toMatchObject({ source: 'trigger', status: 'succeeded', runId });
    expect(review!.steps[0]).toMatchObject({ state: 'succeeded' });
    expect(await listHolds(t.db, t.workspaceId, FLOW)).toEqual([]);
  });

  it('holds the publish on a High finding, and releasing the hold never pushes', async () => {
    await gate('Review the change.\n[High] the token is written to the log', {
      holdOnFindings: true,
    });
    const chat = await chatOnItsBranch(t, base, `gate-${chats}`, 'full-auto');

    const { run, replies, prompts } = await turn(chat, BUILD);

    expect(run.status).toBe('succeeded');
    expect(prompts).toBe(1);
    expect(stub.github.pulls).toEqual([]);
    expect(onRemote(chat)).toBe(false);
    expect(replies.at(-1)).toContain('Not published: Flow gate found');
    const [hold] = await listHolds(t.db, t.workspaceId, FLOW);
    expect(hold).toMatchObject({ state: 'open', finished: true });
    expect(hold!.findings).toBeGreaterThan(0);

    expect(await releaseHold(t.db, t.workspaceId, hold!.id)).toBe(true);
    expect(await releaseHold(t.db, t.workspaceId, hold!.id)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(stub.github.pulls).toEqual([]);
    expect(onRemote(chat)).toBe(false);
  });

  it('only reports findings when holding is off', async () => {
    await gate('Review the change.\n[Critical] SQL built from input');
    const chat = await chatOnItsBranch(t, base, `gate-${chats}`, 'full-auto');

    const { prompts } = await turn(chat, BUILD);

    expect(prompts).toBe(2);
    expect(stub.github.pulls).toHaveLength(1);
    expect(await listHolds(t.db, t.workspaceId, FLOW)).toEqual([]);
  });

  it('a stop during the review publishes nothing and closes the review as stopped', async () => {
    await gate('Review slowly. #slow', { holdOnFindings: true });
    const chat = await chatOnItsBranch(t, base, `gate-${chats}`, 'full-auto');
    const runId = await sendMessage(t, chat.conversationId, BUILD, {
      permission: 'do',
      level: 'full-auto',
    });

    const review = await eventually(async () => {
      const [found] = await gateRuns();
      return found?.steps[0]?.state === 'running' ? found : null;
    }, 60_000);
    await requestCancel(t.db, runId);
    await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 60_000);

    expect(stub.github.pulls).toEqual([]);
    expect(onRemote(chat)).toBe(false);
    const [closed] = await gateRuns();
    expect(closed).toMatchObject({ id: review.id, status: 'cancelled' });
    const replies = await repliesOf(t, runId);
    expect(replies.join('\n')).not.toContain('Opened pull request');
    if (replies.some((reply) => reply.includes('Not published'))) {
      expect(replies.join('\n')).toContain(GATE_STOPPED_LINE);
    }
  });

  it('a review left running by a dead worker is closed once its turn has ended', async () => {
    await gate('Review the change.', { holdOnFindings: true });
    const chat = await chatOnItsBranch(t, base, `gate-${chats}`, 'full-auto');
    const { runId } = await turn(chat, BUILD);
    await t.db.query(
      `UPDATE workflow_runs SET status = 'running', finished_at = NULL WHERE gates_run_id = $1`,
      [runId],
    );
    await t.db.query(`UPDATE runs SET status = 'running', finished_at = NULL WHERE id = $1`, [
      runId,
    ]);

    expect(await settleStrandedRuns(t.db)).toBe(0);

    await t.db.query(
      `UPDATE runs SET status = 'outcome_unknown', finished_at = now() WHERE id = $1`,
      [runId],
    );
    expect(await settleStrandedRuns(t.db)).toBe(1);
    const [closed] = await gateRuns();
    expect(closed!.status).toBe('outcome_unknown');
  });
});
