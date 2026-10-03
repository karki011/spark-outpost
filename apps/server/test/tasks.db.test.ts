import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanEntry } from '@spark-outpost/contracts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { LeaseLostError, appendRunEvent } from '../src/persistence/run-events.ts';
import { getRun } from '../src/persistence/runs.ts';
import { getTaskDetail } from '../src/persistence/task-views.ts';
import { FAKE_PR_URL, createFakeProvider } from '../src/providers/fake.ts';
import type { Provider, ProviderOutput } from '../src/providers/provider.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function scripted(script: (prompt: string) => ProviderOutput[]): Provider {
  return {
    name: 'scripted',
    async *run(turn) {
      yield* script(turn.prompt);
    },
  };
}

function start(provider: Provider = createFakeProvider({ stepMs: 0, wordMs: 0 })) {
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
  });
  return provider.name;
}

async function newConversation() {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

async function sendAndSettle(conversationId: string, content: string, provider = 'fake') {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider, model: 'fake-fast', effort: 'low' },
  );
  const run = await eventually(async () => {
    const current = await getRun(t.db, sent.run.id);
    return current?.finishedAt ? current : null;
  });
  return run;
}

async function runRow(runId: string) {
  const { rows } = await t.db.query<{ task_id: string | null; plan_version: number | null }>(
    'SELECT task_id, plan_version FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]!;
}

const entries = (...contents: string[]): PlanEntry[] =>
  contents.map((content) => ({ content, priority: 'medium', status: 'pending' }));

describe('tasks', () => {
  it('leaves a chit-chat run without a task', async () => {
    start();
    const conversationId = await newConversation();
    const run = await sendAndSettle(conversationId, 'Hello');
    expect((await runRow(run.id)).task_id).toBeNull();
    expect((await getConversationDetail(t.db, conversationId))?.tasks).toEqual([]);
  });

  it('opens a task for a run that plans, versions the plan and captures the PR', async () => {
    start();
    const conversationId = await newConversation();
    const run = await sendAndSettle(conversationId, 'Fix the divider #plan');
    expect(run.status).toBe('succeeded');

    const { task_id: taskId, plan_version } = await runRow(run.id);
    expect(taskId).not.toBeNull();
    expect(plan_version).toBe(1);

    const task = await getTaskDetail(t.db, taskId!);
    expect(task).toMatchObject({ title: 'Fix the divider #plan', status: 'open', planVersion: 1 });
    expect(task!.planVersions.map((version) => [version.version, version.supersededBy])).toEqual([
      [1, null],
    ]);
    expect(task!.planVersions[0]!.body.entries.map((entry) => entry.status)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    expect(task!.planVersions[0]!.usedBy).toEqual([run.id]);
    expect(task!.links).toMatchObject([
      { kind: 'pr', url: FAKE_PR_URL, title: 'spark-outpost/demo#42', source: 'agent_text' },
    ]);
    expect(task!.summary.text).toBe(`${task!.summary.done} of ${task!.summary.total} done`);
    expect(task!.items.find((item) => item.id === 'planned')).toMatchObject({
      agent: { provider: 'fake', model: 'fake-fast', effort: 'low' },
    });

    const { rows } = await t.db.query<{ payload: { activityType?: string; messageId?: string } }>(
      `SELECT payload FROM run_events WHERE run_id = $1 AND type = 'ACTIVITY_SNAPSHOT' ORDER BY seq`,
      [run.id],
    );
    const activities = rows
      .map((row) => row.payload.activityType)
      .filter((type) => type !== 'orchestration');
    expect(activities).toEqual(['task', 'plan', 'plan', 'plan', 'link']);

    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.tasks).toHaveLength(1);
    expect(detail?.tasks[0]).toMatchObject({ id: taskId, runIds: [run.id], costUsd: 0.0042 });
  });

  it('shows the model and effort the run actually used, and labels estimated cost', async () => {
    start();
    const conversationId = await newConversation();
    const run = await sendAndSettle(conversationId, 'Fix the divider #plan');
    const { task_id: taskId } = await runRow(run.id);
    await t.db.query(
      `UPDATE runs SET used_model = 'fake-deep', used_effort = 'high', cost_source = 'estimated',
         duration_ms = 1234 WHERE id = $1`,
      [run.id],
    );

    const task = await getTaskDetail(t.db, taskId!);
    expect(task!.runs[0]).toMatchObject({
      model: 'fake-deep',
      effort: 'high',
      costSource: 'estimated',
      durationMs: 1234,
    });
    expect(task!.costSource).toBe('estimated');
    expect(task!.items.find((item) => item.id === `run:${run.id}`)).toMatchObject({
      agent: { provider: 'fake', model: 'fake-deep', effort: 'high' },
      costSource: 'estimated',
    });
  });

  it('joins follow-ups to the open task so plan versions span runs', async () => {
    start();
    const conversationId = await newConversation();
    const first = await sendAndSettle(conversationId, 'Fix it #plan');
    const taskId = (await runRow(first.id)).task_id;

    const chat = await sendAndSettle(conversationId, 'Thanks, what changed?');
    expect(await runRow(chat.id)).toEqual({ task_id: taskId, plan_version: 1 });

    const again = await sendAndSettle(conversationId, 'Also add a test #plan');
    expect(await runRow(again.id)).toEqual({ task_id: taskId, plan_version: 1 });

    const task = await getTaskDetail(t.db, taskId!);
    expect(task!.planVersions.map((version) => version.version)).toEqual([1]);
    expect(task!.planVersions[0]!.usedBy).toEqual([first.id, chat.id, again.id]);
    expect(task!.planVersions[0]!.sourceRunId).toBe(again.id);
    expect(task!.links).toHaveLength(1);
    expect(task!.items.map((item) => item.label)).toContain('Follow-up: Also add a test #plan');
  });

  it('starts a new task after the previous one is closed', async () => {
    start();
    const conversationId = await newConversation();
    const first = await sendAndSettle(conversationId, 'Fix it #plan');
    const firstTask = (await runRow(first.id)).task_id;
    await t.db.query(`UPDATE tasks SET status = 'closed', closed_at = now() WHERE id = $1`, [
      firstTask,
    ]);

    const chat = await sendAndSettle(conversationId, 'Hi again');
    expect((await runRow(chat.id)).task_id).toBeNull();
    const next = await sendAndSettle(conversationId, 'New work #plan');
    const nextTask = (await runRow(next.id)).task_id;
    expect(nextTask).not.toBe(firstTask);
    expect((await getTaskDetail(t.db, nextTask!))?.planVersions[0]?.version).toBe(1);
  });

  it('adds a version per run that changes the plan and supersedes a replaced one', async () => {
    const plans: Record<string, PlanEntry[][]> = {
      'Plan it': [entries('Read', 'Fix', 'Test'), entries('Read', 'Fix', 'Add docs')],
      'Update it': [entries('Read', 'Fix', 'Add docs'), entries('Read', 'Fix', 'Add docs', 'Ship')],
      'Replace it': [entries('Rewrite', 'Ship')],
    };
    const name = start(
      scripted((prompt) => [
        ...(plans[prompt] ?? []).map((plan): ProviderOutput => ({ kind: 'plan', entries: plan })),
        { kind: 'text_delta', delta: 'ok' },
      ]),
    );
    const conversationId = await newConversation();
    const first = await sendAndSettle(conversationId, 'Plan it', name);
    await sendAndSettle(conversationId, 'Update it', name);
    await sendAndSettle(conversationId, 'Replace it', name);
    const task = await getTaskDetail(t.db, (await runRow(first.id)).task_id!);
    expect(task!.planVersions.map((version) => [version.version, version.supersededBy])).toEqual([
      [1, null],
      [2, 3],
      [3, null],
    ]);
    expect(task!.planVersions[0]!.body.entries.map((entry) => entry.content)).toEqual([
      'Read',
      'Fix',
      'Add docs',
    ]);
  });

  it('folds a looping plan within one run into a single version', async () => {
    const name = start(
      scripted(() =>
        Array.from({ length: 205 }, (_, index): ProviderOutput => ({
          kind: 'plan',
          entries: entries(`Step ${index}`),
        })),
      ),
    );
    const conversationId = await newConversation();
    const run = await sendAndSettle(conversationId, 'Loop', name);
    const taskId = (await runRow(run.id)).task_id!;
    const { rows } = await t.db.query<{ count: string; max: number }>(
      `SELECT COUNT(*) AS count, MAX(version) AS max FROM run_artifacts WHERE task_id = $1`,
      [taskId],
    );
    expect(rows[0]).toEqual({ count: '1', max: 1 });
    const latest = (await getTaskDetail(t.db, taskId))!.planVersions.at(-1)!;
    expect(latest.body.entries[0]?.content).toBe('Step 204');
  });

  it('opens a task on a tool call and ignores PR links in chit-chat', async () => {
    const name = start(
      scripted((prompt) =>
        prompt === 'work'
          ? [
              { kind: 'step_started', name: 'gh pr create', tool: true },
              {
                kind: 'link',
                url: 'https://github.com/o/r/pull/9',
                title: 'o/r#9',
                source: 'tool_output',
              },
              { kind: 'step_finished', name: 'gh pr create' },
              { kind: 'text_delta', delta: 'Done' },
            ]
          : [{ kind: 'text_delta', delta: 'See https://github.com/o/r/pull/1' }],
      ),
    );
    const chatOnly = await sendAndSettle(await newConversation(), 'chat', name);
    expect((await runRow(chatOnly.id)).task_id).toBeNull();

    const working = await sendAndSettle(await newConversation(), 'work', name);
    const task = await getTaskDetail(t.db, (await runRow(working.id)).task_id!);
    expect(task!.planVersion).toBeNull();
    expect(task!.links).toMatchObject([
      { url: 'https://github.com/o/r/pull/9', source: 'tool_output' },
    ]);
    expect(task!.items.map((item) => item.id)).toEqual([
      'understood',
      `run:${working.id}`,
      'pr:https://github.com/o/r/pull/9',
    ]);
  });

  it('lists only pull requests the chat opened, not ones the agent mentioned', async () => {
    const opened = 'https://github.com/o/r/pull/30';
    const mentioned = 'https://github.com/o/r/pull/2177';
    const name = start(
      scripted(() => [
        { kind: 'step_started', name: 'gh pr create', tool: true },
        { kind: 'link', url: opened, title: 'o/r#30', source: 'tool_output' },
        { kind: 'step_finished', name: 'gh pr create' },
        { kind: 'text_delta', delta: `Opened it. Similar work: ${mentioned}` },
      ]),
    );
    const working = await sendAndSettle(await newConversation(), 'work', name);
    const task = await getTaskDetail(t.db, (await runRow(working.id)).task_id!);

    expect(task!.links.map((link) => [link.url, link.source])).toEqual([
      [opened, 'tool_output'],
      [mentioned, 'agent_text'],
    ]);
    expect(task!.items.filter((item) => item.id.startsWith('pr:'))).toEqual([
      expect.objectContaining({ label: 'Opened o/r#30', state: 'done' }),
    ]);
  });

  it('writes no plan once the worker lost its lease', async () => {
    const conversationId = await newConversation();
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'x' },
      { provider: 'fake' },
    );
    const taskId = randomUUID();
    await t.db.query(`INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, 'T')`, [
      taskId,
      conversationId,
    ]);
    const lease = (await claimNextJob(t.db, 30))!;
    await t.db.query(`UPDATE jobs SET lease_token = $2 WHERE id = $1`, [lease.jobId, randomUUID()]);
    const body = { entries: entries('A') };
    await expect(
      appendRunEvent(
        t.db,
        lease,
        runEvents.activity('artifact:plan', 'plan', { version: 1, body }),
        {
          artifact: {
            taskId,
            kind: 'plan',
            version: 1,
            body,
            overwrite: false,
            supersedesPrevious: false,
          },
        },
      ),
    ).rejects.toBeInstanceOf(LeaseLostError);
    const { rowCount } = await t.db.query('SELECT 1 FROM run_artifacts WHERE task_id = $1', [
      taskId,
    ]);
    expect(rowCount).toBe(0);
    expect((await runRow(sent.run.id)).plan_version).toBeNull();
  });

  it('removes tasks, plans and links with their conversation', async () => {
    start();
    const conversationId = await newConversation();
    await sendAndSettle(conversationId, 'Fix it #plan');
    await t.db.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    const { rows } = await t.db.query<{ tasks: string; artifacts: string; links: string }>(
      `SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM run_artifacts) AS artifacts,
         (SELECT COUNT(*) FROM task_links) AS links`,
    );
    expect(rows[0]).toEqual({ tasks: '0', artifacts: '0', links: '0' });
  });
});
