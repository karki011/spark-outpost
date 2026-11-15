import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workflowTriggersSchema, type WorkflowTriggersView } from '@spark-outpost/contracts';
import { holdPublish } from '../src/crew-flows/publish-holds.ts';
import { getTriggers } from '../src/crew-flows/trigger-records.ts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { createTestApp, localClient } from './app-support.ts';
import { FLOW } from './crew-schedule-support.ts';
import { newSpark, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo } from './turn-support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let root: string;
let client: ReturnType<typeof localClient>;
let dropWorkflows: () => Promise<void>;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  client = localClient(createTestApp(t));
  const pip = await newSpark(t, 'Pip');
  await saveFlow(t, FLOW, [step('review', pip.id)]);
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

const path = `/api/workflows/${FLOW}/triggers`;

describe('trigger routes', () => {
  it('saves, reads and deletes the triggers of a workflow', async () => {
    const empty = await client.get(path).expect(200);
    expect(empty.body).toEqual({ triggers: null, events: [], holds: [] });

    const triggers = workflowTriggersSchema.parse({
      turnChanged: true,
      commit: true,
      branchGlob: 'spark/*',
      debounceMinutes: 3,
      edits: true,
    });
    const saved = await client.send('put', path, triggers).expect(200);
    expect((saved.body as WorkflowTriggersView).triggers).toEqual(triggers);

    await client.send('delete', path).expect(204);
    expect(await getTriggers(t.db, t.workspaceId, FLOW)).toBeNull();
  });

  it('refuses a project that is not in Spark and a workflow that does not exist', async () => {
    const triggers = workflowTriggersSchema.parse({ turnChanged: true, projectId: randomUUID() });
    await client.send('put', path, triggers).expect(400);
    await client.get('/api/workflows/missing/triggers').expect(404);
  });

  it('releases an open hold once and never publishes', async () => {
    await client.send('put', path, workflowTriggersSchema.parse({ beforePublish: true }));
    const conversationId = await openChat(t, { root });
    await holdPublish(t.db, {
      workspaceId: t.workspaceId,
      conversationId,
      workflowId: FLOW,
      workflowRunId: null,
      diffHash: 'abc',
      findings: 2,
      finished: true,
    });
    const [hold] = ((await client.get(path).expect(200)).body as WorkflowTriggersView).holds;
    expect(hold).toMatchObject({ state: 'open', findings: 2 });

    await client.send('post', `/api/workflow-holds/${hold!.id}/release`).expect(204);
    await client.send('post', `/api/workflow-holds/${hold!.id}/release`).expect(404);
    const { rowCount } = await t.db.query('SELECT 1 FROM runs WHERE conversation_id = $1', [
      conversationId,
    ]);
    expect(rowCount).toBe(0);
  });

  it('keeps every trigger route on the Mac', () => {
    for (const route of [
      'GET /api/workflows/:id/triggers',
      'PUT /api/workflows/:id/triggers',
      'DELETE /api/workflows/:id/triggers',
      'POST /api/workflow-holds/:id/release',
    ]) {
      expect(ROUTE_RULES.get(route), route).toBe('never');
    }
  });
});
