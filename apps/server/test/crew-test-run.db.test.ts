import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowRun, WorkflowTestRun } from '@spark-outpost/contracts';
import { sweepTestRuns } from '../src/crew-flows/test-run.ts';
import { createProject } from '../src/projects/projects.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { newSpark, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { gitRepo, removeRepo } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let projectId: string;
let client: ReturnType<typeof localClient>;
let harness: Worker | null = null;
let host: SparkMcpHost | null = null;
let dropWorkflows: () => Promise<void>;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  projectId = (await createProject(t.db, t.workspaceId, root)).project.id;
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  client = localClient(createTestApp(t, { fixedRunProvider: null, deleteSettleMs: 5_000 }));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await host?.close();
  host = null;
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

async function savedFlow(prompts: Record<string, string>) {
  const bolt = await newSpark(t, 'Bolt', { provider: 'claude', agentMode: 'bypassPermissions' });
  const ids = Object.keys(prompts);
  const workflow = {
    id: 'pre-pr',
    name: 'Pre-PR review',
    steps: ids.map((id, index) =>
      step(id, bolt.id, { prompt: prompts[id]!, dependsOn: index === 0 ? [] : [ids[index - 1]!] }),
    ),
  };
  await client.send('put', '/api/workflows/pre-pr', { workflow, baseHash: null }).expect(200);
  return bolt;
}

async function startTest(body: Record<string, unknown> = {}): Promise<WorkflowRun> {
  const started = await client
    .send('post', '/api/workflows/pre-pr/runs', { kind: 'test', projectId, ...body })
    .expect(201);
  return started.body as WorkflowRun;
}

const testRun = async (id: string) =>
  (await client.get(`/api/workflow-runs/${id}/test`).expect(200)).body as WorkflowTestRun;

const settled = (id: string) =>
  eventually(async () => {
    const view = await testRun(id);
    return view.run.status === 'running' ? null : view;
  }, 60_000);

async function copies() {
  const { rows } = await t.db.query<{ path: string; branch: string; removed: boolean }>(
    'SELECT path, branch, removed_at IS NOT NULL AS removed FROM chat_worktrees',
  );
  return rows;
}

const branches = () =>
  execFileSync('git', ['-C', root, 'branch', '--list', 'spark/test-run-*']).toString().trim();

async function count(table: string): Promise<number> {
  const { rows } = await t.db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ${table}`,
  );
  return rows[0]!.total;
}

describe('a test run of a workflow', () => {
  it('runs on a throw-away copy, holds every send and stays hidden', async () => {
    await savedFlow({
      where: '#cwd',
      probe: 'Check the site. #command',
      make: 'Add a teammate. #spark spark_create_spark {"name":"Nova"}',
    });
    host = await startSparkMcpHost(toolDeps(t));
    harness = startTurnWorker(t, {
      sparkTools: host,
      agentEnv: { FAKE_ACP_MCP_CAPABILITIES: JSON.stringify({ http: true, sse: false }) },
    });

    const started = await startTest({ message: 'for 2.4' });
    expect(started).toMatchObject({ kind: 'test', workflowId: 'pre-pr', status: 'running' });
    const [copy] = await copies();
    expect(copy!.path.startsWith(join(root, '.spark', 'worktrees'))).toBe(true);
    expect(existsSync(join(copy!.path, 'notes.txt'))).toBe(true);

    const done = await settled(started.id);

    expect(done.run.status).toBe('succeeded');
    expect(done).toMatchObject({ message: 'for 2.4', projectId, oneSpark: false, waiting: [] });
    const notes = Object.fromEntries(done.run.steps.map((entry) => [entry.stepId, entry.note]));
    expect(notes.where).toContain(`cwd=${copy!.path}`);
    expect(notes.probe).toContain('permission=no');
    expect(notes.make).toContain('Held: this is a test run');
    expect(done.held.map((held) => [held.stepId, held.kind])).toEqual([
      ['probe', 'command'],
      ['make', 'spark_action'],
    ]);
    expect(done.held[0]!.summary).toContain('curl');
    expect(done.held[1]!.summary).toContain('spark_create_spark: name Nova');
    const sparks = await t.db.query('SELECT 1 FROM teammates WHERE name = $1', ['Nova']);
    expect(sparks.rowCount).toBe(0);

    const prompts = await t.db.query<{ prompt: string; test: string | null }>(
      `SELECT prompt, route->'spark'->>'test' AS test FROM runs WHERE parent_run_id = $1`,
      [done.run.runId],
    );
    expect(prompts.rows.every((row) => row.test === 'true')).toBe(true);
    expect(prompts.rows[0]!.prompt).toContain('This is a test run on a throw-away copy');

    expect((await client.get('/api/conversations').expect(200)).body).toEqual([]);
    expect((await client.get('/api/attention').expect(200)).body.items).toEqual([]);
    expect((await client.get('/api/workflows/pre-pr/runs').expect(200)).body.runs).toEqual([]);
    const kinds = await t.db.query<{ kind: string }>('SELECT kind FROM conversations');
    expect(kinds.rows).toEqual([{ kind: 'crew' }]);
  }, 120_000);

  it('deletes the copy, the hidden chat, the run and its steps on Discard', async () => {
    await savedFlow({ probe: 'Check the site. #command' });
    harness = startTurnWorker(t);
    const started = await startTest();
    await settled(started.id);
    const [copy] = await copies();
    expect(branches()).not.toBe('');

    await client.send('delete', `/api/workflow-runs/${started.id}`).expect(204);

    expect(existsSync(copy!.path)).toBe(false);
    expect(branches()).toBe('');
    expect((await copies()).every((entry) => entry.removed)).toBe(true);
    for (const table of [
      'conversations',
      'runs',
      'messages',
      'workflow_runs',
      'workflow_run_steps',
      'workflow_held_sends',
    ]) {
      expect([table, await count(table)]).toEqual([table, 0]);
    }
    await client.get(`/api/workflow-runs/${started.id}/test`).expect(404);
    await client.send('delete', `/api/workflow-runs/${started.id}`).expect(404);
  }, 120_000);

  it('stops a test run that is still working when it is discarded', async () => {
    await savedFlow({ wait: '#slow', next: 'after' });
    harness = startTurnWorker(t);
    const started = await startTest();
    await eventually(async () => {
      const view = await testRun(started.id);
      return view.run.steps[0]?.state === 'running' ? true : null;
    }, 60_000);

    await client.send('delete', `/api/workflow-runs/${started.id}`).expect(204);

    expect(await count('runs')).toBe(0);
    expect(await count('workflow_runs')).toBe(0);
    expect(branches()).toBe('');
  }, 120_000);

  it('refuses to discard an ordinary run', async () => {
    await savedFlow({ only: 'hello' });
    const real = await client.send('post', '/api/workflows/pre-pr/runs', { projectId }).expect(201);

    await client.send('delete', `/api/workflow-runs/${real.body.id}`).expect(400);
    await client.get(`/api/workflow-runs/${real.body.id}/test`).expect(404);
    expect(await count('workflow_runs')).toBe(1);
  });

  it('removes test runs left by a crash at start-up and leaves ordinary runs', async () => {
    await savedFlow({ only: 'hello' });
    const real = await client.send('post', '/api/workflows/pre-pr/runs', { projectId }).expect(201);
    await startTest();
    await startTest({ projectId: null });
    const [copy] = await copies();

    expect(await sweepTestRuns({ db: t.db, workspaceId: t.workspaceId })).toBe(2);

    expect(existsSync(copy!.path)).toBe(false);
    expect(branches()).toBe('');
    const left = await t.db.query<{ id: string; kind: string }>(
      'SELECT id, kind FROM workflow_runs',
    );
    expect(left.rows).toEqual([{ id: real.body.id, kind: 'run' }]);
    expect(await count('conversations')).toBe(1);
  });

  it('runs for real with the same message and project, in a chat the list shows', async () => {
    await savedFlow({ only: 'hello' });
    harness = startTurnWorker(t);
    const started = await startTest({ message: 'for 2.4' });
    const tested = await settled(started.id);

    const real = await client
      .send('post', '/api/workflows/pre-pr/runs', {
        message: tested.message,
        projectId: tested.projectId,
      })
      .expect(201);
    await client.send('delete', `/api/workflow-runs/${started.id}`).expect(204);

    expect(real.body).toMatchObject({ kind: 'run', workflowId: 'pre-pr' });
    await eventually(async () => {
      const run = (await client.get(`/api/workflow-runs/${real.body.id}`)).body as WorkflowRun;
      return run.status === 'succeeded' ? true : null;
    }, 60_000);
    const listed = (await client.get('/api/conversations').expect(200)).body;
    expect(listed.map((chat: { id: string }) => chat.id)).toEqual([real.body.conversationId]);
    const message = await t.db.query<{ content: string }>(
      `SELECT content FROM messages WHERE role = 'user'`,
    );
    expect(message.rows).toEqual([{ content: '@pre-pr for 2.4' }]);
    expect((await copies()).filter((entry) => !entry.removed)).toEqual([]);
  }, 120_000);

  it('starts one test run for a repeated request', async () => {
    await savedFlow({ only: 'hello' });
    const key = '6f0f4c1e-51a5-4b7e-9a55-0d6d2c9f7a10';
    const post = () =>
      client
        .send('post', '/api/workflows/pre-pr/runs', { kind: 'test', projectId })
        .set('Idempotency-Key', key);

    const first = await post().expect(201);
    const second = await post().expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(await count('conversations')).toBe(1);
    expect((await copies()).length).toBe(1);
  });

  it('runs with no project and without a copy', async () => {
    await savedFlow({ only: 'hello' });
    harness = startTurnWorker(t);

    const started = await startTest({ projectId: null });
    const done = await settled(started.id);

    expect(done.run.status).toBe('succeeded');
    expect(done).toMatchObject({ projectId: null, projectName: null, held: [] });
    expect(await copies()).toEqual([]);
    await client.send('delete', `/api/workflow-runs/${started.id}`).expect(204);
    expect(await count('conversations')).toBe(0);
  }, 120_000);

  it('refuses a project that is not a git repository and leaves nothing behind', async () => {
    await savedFlow({ only: 'hello' });
    const plain = await mkdtemp(join(tmpdir(), 'spark-plain-'));
    const other = (await createProject(t.db, t.workspaceId, plain)).project.id;

    const refused = await client
      .send('post', '/api/workflows/pre-pr/runs', { kind: 'test', projectId: other })
      .expect(400);

    expect(refused.body.error).toContain('git repository');
    expect(await count('conversations')).toBe(0);
    expect(await count('workflow_runs')).toBe(0);
    await rm(plain, { recursive: true, force: true });
  });
});

describe('Try it for one Spark', () => {
  it('runs the Spark as a one-step workflow that is never saved', async () => {
    const bolt = await newSpark(t, 'Bolt', { provider: 'claude', agentMode: 'bypassPermissions' });
    harness = startTurnWorker(t);

    const started = await client
      .send('post', `/api/teammates/${bolt.id}/test-runs`, {
        projectId,
        message: 'Review the last commit. #command',
      })
      .expect(201);
    const done = await settled((started.body as WorkflowRun).id);

    expect(done.run).toMatchObject({
      kind: 'test',
      workflowId: 'try-it',
      workflowName: 'Bolt',
      status: 'succeeded',
    });
    expect(done.oneSpark).toBe(true);
    expect(done.run.steps.map((entry) => [entry.stepId, entry.sparkId])).toEqual([
      ['try-it', bolt.id],
    ]);
    expect(done.held.map((held) => held.kind)).toEqual(['command']);
    expect((await client.get('/api/workflows').expect(200)).body.workflows).toEqual([]);
    await client.send('delete', `/api/workflow-runs/${done.run.id}`).expect(204);
    expect(await count('conversations')).toBe(0);
  }, 120_000);

  it('answers 404 for a Spark that does not exist', async () => {
    await client
      .send('post', '/api/teammates/6f0f4c1e-51a5-4b7e-9a55-0d6d2c9f7a10/test-runs', {})
      .expect(404);
  });
});
