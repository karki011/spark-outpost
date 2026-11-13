import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowRun } from '@spark-outpost/contracts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { newSpark, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let client: ReturnType<typeof localClient>;
let harness: Worker | null = null;
let dropWorkflows: () => Promise<void>;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  client = localClient(createTestApp(t, { fixedRunProvider: null }));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

async function savedFlow(id = 'release-check') {
  const pip = await newSpark(t, 'Pip');
  const workflow = {
    id,
    name: 'Release check',
    steps: [step('tests', pip.id), step('notes', pip.id, { dependsOn: ['tests'] })],
  };
  const saved = await client.send('put', `/api/workflows/${id}`, { workflow, baseHash: null });
  expect(saved.status).toBe(200);
  return { pip, workflow, hash: saved.body.hash as string };
}

const settled = (id: string) =>
  eventually(async () => {
    const run = (await client.get(`/api/workflow-runs/${id}`)).body as WorkflowRun;
    return run.status === 'running' ? null : run;
  }, 60_000);

describe('workflow files', () => {
  it('saves, lists, reads and deletes a workflow', async () => {
    const { pip, workflow, hash } = await savedFlow();

    const listed = await client.get('/api/workflows').expect(200);
    expect(listed.body).toEqual({
      workflows: [
        {
          id: 'release-check',
          name: 'Release check',
          stages: [[{ stepId: 'tests', sparkId: pip.id }], [{ stepId: 'notes', sparkId: pip.id }]],
          problems: 0,
        },
      ],
    });
    const read = await client.get('/api/workflows/release-check').expect(200);
    expect(read.body).toEqual({ workflow, hash });

    await client.send('delete', '/api/workflows/release-check').expect(204);
    await client.get('/api/workflows/release-check').expect(404);
    await client.send('delete', '/api/workflows/release-check').expect(404);
  });

  it('refuses a save over a file that changed, and a second create', async () => {
    const { workflow, hash } = await savedFlow();
    const renamed = { ...workflow, name: 'Release gate' };

    await client
      .send('put', '/api/workflows/release-check', { workflow: renamed, baseHash: null })
      .expect(409);
    await client
      .send('put', '/api/workflows/release-check', { workflow: renamed, baseHash: 'stale' })
      .expect(409);
    const saved = await client
      .send('put', '/api/workflows/release-check', { workflow: renamed, baseHash: hash })
      .expect(200);
    expect(saved.body.hash).not.toBe(hash);
    expect(saved.body.workflow.name).toBe('Release gate');
  });

  it('refuses a workflow with a cycle or a Spark that does not exist', async () => {
    const pip = await newSpark(t, 'Pip');
    const cycle = {
      id: 'loop',
      name: 'Loop',
      steps: [step('aa', pip.id, { dependsOn: ['bb'] }), step('bb', pip.id, { dependsOn: ['aa'] })],
    };
    const ghost = { id: 'ghost', name: 'Ghost', steps: [step('aa', randomUUID())] };

    const looped = await client.send('put', '/api/workflows/loop', {
      workflow: cycle,
      baseHash: null,
    });
    expect(looped.status).toBe(400);
    expect(looped.body.error).toContain('wait on each other');
    await client
      .send('put', '/api/workflows/ghost', { workflow: ghost, baseHash: null })
      .expect(400);
    await client
      .send('put', '/api/workflows/other', { workflow: ghost, baseHash: null })
      .expect(400);
    expect((await client.get('/api/workflows')).body.workflows).toEqual([]);
  });

  it('counts a problem when a Spark is deleted after the save', async () => {
    const { pip } = await savedFlow();
    await t.db.query('DELETE FROM teammates WHERE id = $1', [pip.id]);

    const listed = await client.get('/api/workflows').expect(200);
    expect(listed.body.workflows[0].problems).toBe(2);
    await client.send('post', '/api/workflows/release-check/runs', {}).expect(400);
  });
});

describe('workflow runs', () => {
  it('starts a run in a new chat, runs it and lists it', async () => {
    await savedFlow();
    harness = startTurnWorker(t);

    const started = await client
      .send('post', '/api/workflows/release-check/runs', { message: 'for 2.4' })
      .expect(201);
    const first = started.body as WorkflowRun;
    expect(first).toMatchObject({
      workflowId: 'release-check',
      workflowName: 'Release check',
      kind: 'run',
      source: 'manual',
      status: 'running',
    });
    expect(first.steps.map((entry) => entry.state)).toEqual(['waiting', 'waiting']);

    const done = await settled(first.id);
    expect(done.status).toBe('succeeded');
    expect(done.steps.map((entry) => entry.state)).toEqual(['succeeded', 'succeeded']);
    const top = await t.db.query<{ source: string; content: string; title: string }>(
      `SELECT r.source, m.content, c.title FROM runs r
       JOIN messages m ON m.id = r.user_message_id
       JOIN conversations c ON c.id = r.conversation_id WHERE r.id = $1`,
      [done.runId],
    );
    expect(top.rows).toEqual([
      { source: 'workflow', content: '@release-check for 2.4', title: 'Release check' },
    ]);
    const listed = await client.get('/api/workflows/release-check/runs').expect(200);
    expect(listed.body.runs.map((run: WorkflowRun) => run.id)).toEqual([first.id]);
  }, 90_000);

  it('starts one run for a repeated request with the same Idempotency-Key', async () => {
    await savedFlow();
    const conversationId = await openChat(t, { root, level: 'hands-off' });
    const key = randomUUID();
    const post = () =>
      client
        .send('post', '/api/workflows/release-check/runs', { conversationId })
        .set('Idempotency-Key', key);

    const first = await post().expect(201);
    const second = await post().expect(201);

    expect(second.body.id).toBe(first.body.id);
    const runs = await t.db.query('SELECT 1 FROM runs WHERE conversation_id = $1', [
      conversationId,
    ]);
    expect(runs.rowCount).toBe(1);
    const records = await t.db.query('SELECT 1 FROM workflow_runs');
    expect(records.rowCount).toBe(1);
    await client
      .send('post', '/api/workflows/release-check/runs', {})
      .set('Idempotency-Key', 'nope')
      .expect(400);
  });

  it('stops a run through its top-level turn', async () => {
    const pip = await newSpark(t, 'Pip');
    const workflow = {
      id: 'long',
      name: 'Long',
      steps: [
        step('wait', pip.id, { prompt: '#slow' }),
        step('next', pip.id, { dependsOn: ['wait'] }),
      ],
    };
    await client.send('put', '/api/workflows/long', { workflow, baseHash: null }).expect(200);
    const conversationId = await openChat(t, { root, level: 'hands-off' });
    harness = startTurnWorker(t);
    const started = await client
      .send('post', '/api/workflows/long/runs', { conversationId })
      .expect(201);
    const id = (started.body as WorkflowRun).id;
    await eventually(async () => {
      const run = (await client.get(`/api/workflow-runs/${id}`)).body as WorkflowRun;
      return run.steps[0]?.state === 'running' ? true : null;
    }, 60_000);

    await client.send('post', `/api/workflow-runs/${id}/stop`).expect(200);
    const done = await settled(id);

    expect(done.status).toBe('cancelled');
    expect(done.steps.map((entry) => entry.state)).toEqual(['cancelled', 'skipped']);
    const top = await eventually(async () => {
      const run = await getRun(t.db, done.runId!);
      return run?.finishedAt ? run : null;
    }, 30_000);
    expect(top.status).toBe('cancelled');
    await client.send('post', `/api/workflow-runs/${id}/stop`).expect(200);
  }, 90_000);

  it('answers 404 for a workflow or a run that does not exist', async () => {
    await savedFlow();
    await client.send('post', '/api/workflows/missing/runs', {}).expect(404);
    await client.get(`/api/workflow-runs/${randomUUID()}`).expect(404);
    await client.send('post', `/api/workflow-runs/${randomUUID()}/stop`).expect(404);
    await client
      .send('post', '/api/workflows/release-check/runs', { conversationId: randomUUID() })
      .expect(404);
  });

  it('keeps every workflow route on the Mac', () => {
    const routes = [
      'GET /api/workflows',
      'GET /api/workflows/:id',
      'PUT /api/workflows/:id',
      'DELETE /api/workflows/:id',
      'GET /api/workflows/:id/runs',
      'POST /api/workflows/:id/runs',
      'GET /api/workflow-runs/:id',
      'POST /api/workflow-runs/:id/stop',
      'GET /api/workflow-runs/:id/test',
      'DELETE /api/workflow-runs/:id',
      'POST /api/teammates/:id/test-runs',
    ];
    for (const route of routes) expect(ROUTE_RULES.get(route), route).toBe('never');
  });
});
