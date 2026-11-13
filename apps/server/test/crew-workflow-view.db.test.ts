import { afterEach, beforeEach, expect, it } from 'vitest';
import { parseAppEvent } from '@spark-outpost/contracts';
import { getWorkflowRun } from '../src/crew-flows/run-records.ts';
import { keepListening } from '../src/persistence/notifications.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { newSpark, recordOf, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let harness: Worker | null = null;
let dropWorkflows: () => Promise<void>;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  harness = startTurnWorker(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

it('a run record carries each step’s parents, the turn’s spend and announces its changes', async () => {
  const pip = await newSpark(t, 'Pip');
  await saveFlow(t, 'pair', [
    step('first', pip.id),
    step('second', pip.id, { dependsOn: ['first'] }),
  ]);
  const announced: string[] = [];
  const listener = await keepListening(testDatabaseUrl(), 'changes', (payload) => {
    const event = parseAppEvent(payload);
    if (event?.kind === 'workflow_run' && event.runId) announced.push(event.runId);
  });
  try {
    const conversationId = await openChat(t, { root, level: 'hands-off' });
    const runId = await sendMessage(t, conversationId, '@pair go');
    await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 60_000);
    const record = await recordOf(t, runId);

    expect(record?.steps.map((entry) => [entry.stepId, entry.dependsOn])).toEqual([
      ['first', []],
      ['second', ['first']],
    ]);
    const totals = (await loadOrchestration(t.db, runId))!.totals;
    expect(totals.tokens).toBeGreaterThan(0);
    expect(record?.spend.tokens).toBe(totals.tokens);
    expect(record?.spend.costUsd ?? 0).toBe(totals.costUsd);
    expect(record?.spend.costSource).toBe(totals.costSource);
    expect(await getWorkflowRun(t.db, t.workspaceId, record!.id)).toEqual(record);
    await eventually(async () => announced.filter((id) => id === runId).length >= 6);
  } finally {
    await listener.close();
  }
}, 90_000);
