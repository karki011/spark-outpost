import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STEP_OUTCOME_UNKNOWN,
  insertWorkflowRun,
  settleStrandedRuns,
  startStep,
} from '../src/crew-flows/run-records.ts';
import { insertChildRun } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import type { Worker } from '../src/workflow/worker.ts';
import {
  newSpark,
  recordOf,
  saveFlow,
  statesOf,
  step,
  stepReply,
  useWorkflowsDir,
} from './crew-workflow-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';
import {
  allowOnce,
  auditOf,
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  sendMessage,
} from './turn-support.ts';
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

async function runFlow(text: string, chat: { permission?: 'ask' | 'do'; agentMode?: string } = {}) {
  const conversationId = await openChat(t, { root, level: 'hands-off' });
  const runId = await sendMessage(t, conversationId, text, chat);
  const { asked } = await driveToEnd(t, conversationId, runId, allowOnce, 60_000);
  return { runId, asked, record: await recordOf(t, runId) };
}

interface SentRequest {
  params: {
    value?: string;
    modeId?: string;
    _meta?: { claudeCode: { options: { tools: string[]; settings: Record<string, unknown> } } };
  };
}

async function stepSession(stepRunId: string) {
  const audit = await auditOf(t, stepRunId);
  const sent = audit.filter((entry) => entry.direction === 'to_agent');
  const opened = sent.find((entry) => entry.method === 'session/new')?.payload as SentRequest;
  return {
    options: opened.params._meta!.claudeCode.options,
    chosen: sent
      .filter((entry) => entry.method?.includes('set_'))
      .map((entry) => (entry.payload as SentRequest).params)
      .map((params) => params.value ?? params.modeId),
  };
}

describe('commands in a workflow step', () => {
  it('asks with an ordinary card when the step’s mode asks', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'probe', [step('ping', pip.id, { prompt: 'Check the site. #command' })]);

    const { asked, record } = await runFlow('@probe go');

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ kind: 'execute', runId: record!.steps[0]!.runId });
    expect(await stepReply(t, record, 'ping')).toContain('permission=yes');
    expect(record?.status).toBe('succeeded');
  }, 90_000);

  it('runs at once in the Spark’s own Bypass mode, whatever the chat’s mode is', async () => {
    const bolt = await newSpark(t, 'Bolt', { provider: 'claude', agentMode: 'bypassPermissions' });
    await saveFlow(t, 'probe', [step('ping', bolt.id, { prompt: 'Check the site. #command' })]);

    const { asked, record, runId } = await runFlow('@probe go');

    expect(asked).toEqual([]);
    expect(await stepReply(t, record, 'ping')).toContain('permission=yes');
    const { rows } = await t.db.query<{ agent_mode: string | null; mode: string }>(
      'SELECT agent_mode, mode FROM runs WHERE parent_run_id = $1',
      [runId],
    );
    expect(rows).toEqual([{ agent_mode: 'bypassPermissions', mode: 'ask' }]);
  }, 90_000);

  it('opens the step’s session outside Plan mode, on the Spark’s model, with no way round the gate', async () => {
    const bolt = await newSpark(t, 'Bolt', { provider: 'claude', model: 'haiku' });
    await saveFlow(t, 'probe', [step('ping', bolt.id, { prompt: 'Check the site. #command' })]);

    const { record, runId } = await runFlow('@probe go');

    expect((await getRun(t.db, runId))?.model).toBe('sonnet');
    const stepRunId = record!.steps[0]!.runId!;
    const { options, chosen } = await stepSession(stepRunId);
    expect((await getRun(t.db, stepRunId))?.model).toBe('haiku');
    expect(chosen).toEqual(['read-only']);
    expect(options.tools).toContain('Bash');
    expect(options.tools).not.toContain('Write');
    expect(options.tools).not.toContain('ExitPlanMode');
    expect(options.settings.permissions).not.toHaveProperty('allow');
  }, 90_000);

  it('refuses a file change in every mode, in a chat that may change files', async () => {
    const bolt = await newSpark(t, 'Bolt', { provider: 'claude', agentMode: 'bypassPermissions' });
    await saveFlow(t, 'fixer', [step('fix', bolt.id, { prompt: 'Fix the typo. #write' })]);

    const { asked, record } = await runFlow('@fixer go', {
      permission: 'do',
      agentMode: 'bypassPermissions',
    });

    expect(asked).toEqual([]);
    expect(await stepReply(t, record, 'fix')).toContain('permission=no');
    const changed = await t.db.query('SELECT 1 FROM run_changes LIMIT 1').catch(() => null);
    expect(changed?.rowCount ?? 0).toBe(0);
  }, 90_000);
});

describe('restart recovery', () => {
  it('marks a run whose worker died as outcome unknown and starts nothing again', async () => {
    await harness?.stop();
    harness = null;
    const pip = await newSpark(t, 'Pip');
    const { runId, conversationId } = await startChat(t, '@nightly go');
    const workflow = {
      id: 'nightly',
      name: 'Nightly',
      steps: [step('first', pip.id), step('second', pip.id, { dependsOn: ['first'] })],
    };
    const id = randomUUID();
    await insertWorkflowRun(t.db, {
      id,
      workspaceId: t.workspaceId,
      workflow,
      kind: 'run',
      source: 'mention',
      conversationId,
      runId,
      message: 'go',
      continues: false,
    });
    const lease = await insertChildRun(
      t.db,
      {
        parentRunId: runId,
        role: 'spark',
        stepIndex: 0,
        attempt: 1,
        agentLabel: 'Pip · Code reviewer',
        provider: 'fake',
        model: null,
        effort: null,
        mode: 'chat',
        prompt: 'first',
        route: {
          name: 'Pip',
          spark: { id: pip.id, role: 'Code reviewer', only: true, step: 'first' },
        },
      },
      30,
    );
    await startStep(t.db, id, 'first', lease.runId);
    await t.db.query(
      `UPDATE jobs SET status = 'leased', attempts = 1, lease_token = gen_random_uuid(),
         lease_expires_at = now() - interval '1 minute'
       WHERE run_id = ANY($1::uuid[])`,
      [[runId, lease.runId]],
    );
    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [runId]);

    expect(await settleStrandedRuns(t.db)).toBe(0);
    expect(await recoverExpiredLeases(t.db)).toBe(2);
    expect(await settleStrandedRuns(t.db)).toBe(1);
    expect(await settleStrandedRuns(t.db)).toBe(0);

    const record = await recordOf(t, runId);
    expect(record?.status).toBe('outcome_unknown');
    expect(record?.finishedAt).not.toBeNull();
    expect(statesOf(record)).toEqual({ first: 'failed', second: 'skipped' });
    expect(record?.steps[0]?.note).toBe(STEP_OUTCOME_UNKNOWN);
    expect((await getRun(t.db, runId))?.status).toBe('outcome_unknown');

    harness = startTurnWorker(t);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const children = await t.db.query('SELECT 1 FROM runs WHERE parent_run_id = $1', [runId]);
    expect(children.rowCount).toBe(1);
    expect(statesOf(await recordOf(t, runId))).toEqual({ first: 'failed', second: 'skipped' });
  }, 60_000);

  it('records one run when the same turn is recorded twice', async () => {
    const pip = await newSpark(t, 'Pip');
    await harness?.stop();
    harness = null;
    const { runId, conversationId } = await startChat(t, '@nightly go');
    const run = {
      workspaceId: t.workspaceId,
      workflow: { id: 'nightly', name: 'Nightly', steps: [step('first', pip.id)] },
      kind: 'run' as const,
      source: 'mention' as const,
      conversationId,
      runId,
      message: 'go',
      continues: false,
    };

    expect(await insertWorkflowRun(t.db, { ...run, id: randomUUID() })).toBe(true);
    expect(await insertWorkflowRun(t.db, { ...run, id: randomUUID() })).toBe(false);

    const steps = await t.db.query('SELECT 1 FROM workflow_run_steps');
    expect(steps.rowCount).toBe(1);
  });
});
