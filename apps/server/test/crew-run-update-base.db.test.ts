import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowRunKind, WorkflowTriggerKind } from '@spark-outpost/contracts';
import { workflowTriggersSchema } from '@spark-outpost/contracts';
import { insertWorkflowRun, turnOffEdits, workflowRunById } from '../src/crew-flows/run-records.ts';
import { saveTriggers } from '../src/crew-flows/trigger-records.ts';
import { step } from './crew-workflow-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function allowUpdates(updateBase: boolean) {
  await saveTriggers(t.db, t.workspaceId, 'tidy', {
    ...workflowTriggersSchema.parse({}),
    updateBase,
  });
}

async function run(kind: WorkflowRunKind, triggerKind?: WorkflowTriggerKind) {
  const { conversationId, runId } = await startChat(t, '@tidy');
  const id = randomUUID();
  await insertWorkflowRun(t.db, {
    id,
    workspaceId: t.workspaceId,
    workflow: { id: 'tidy', name: 'Tidy', steps: [step('merge', randomUUID())] },
    kind,
    source: triggerKind ? 'trigger' : 'mention',
    conversationId,
    runId,
    message: '',
    continues: false,
    ...(triggerKind ? { triggerKind } : {}),
  });
  return (await workflowRunById(t.db, id))!;
}

describe('a workflow run that may update the branch from its base', () => {
  it('takes the workflow’s switch for a run from any source', async () => {
    await allowUpdates(true);
    expect((await run('run')).updateBase).toBe(true);
    expect((await run('run', 'commit')).updateBase).toBe(true);
  });

  it('never updates for a Before publish review, a test run or a review', async () => {
    await allowUpdates(true);
    expect((await run('run', 'before_publish')).updateBase).toBe(false);
    expect((await run('test')).updateBase).toBe(false);
    expect((await run('review')).updateBase).toBe(false);
  });

  it('stays off while the switch is off, and when Spark turns a run’s changes off', async () => {
    expect((await run('run')).updateBase).toBe(false);
    await allowUpdates(true);
    const allowed = await run('run');
    await turnOffEdits(t.db, allowed.run.id);
    expect((await workflowRunById(t.db, allowed.run.id))!.updateBase).toBe(false);
  });
});
