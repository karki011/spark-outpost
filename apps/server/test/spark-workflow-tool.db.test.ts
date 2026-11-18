import { beforeEach, describe, expect, it } from 'vitest';
import type { Teammate, WorkflowControlAction } from '@spark-outpost/contracts';
import { getSchedule } from '../src/crew-flows/schedule-records.ts';
import { getTriggers } from '../src/crew-flows/trigger-records.ts';
import { controlWorkflow } from '../src/crew-flows/workflow-control.ts';
import { workflowStore } from '../src/crew-flows/workflow-store.ts';
import { newId } from '../src/persistence/ids.ts';
import { recordObservation } from '../src/persistence/observations.ts';
import { useCrewTools } from './spark-crew-harness.ts';
import { confirmCard, pendingCard } from './spark-mcp-support.ts';
import { connectCliProvider, type TestDb } from './support.ts';

const crew = useCrewTools();
const { call } = crew;
let t: TestDb;
let chat: { conversationId: string; runId: string };
let scout: Teammate;

beforeEach(async () => {
  ({ t, chat, scout } = crew.state());
  await connectCliProvider(t, 'claude');
  await workflowStore().save(
    {
      id: 'nightly',
      name: 'Nightly',
      steps: [
        {
          id: 'look',
          sparkId: scout.id,
          prompt: '',
          dependsOn: [],
          join: 'all',
          onFailure: 'stop',
        },
      ],
    },
    null,
    new Set([scout.id]),
  );
});

const agentRuns = async () => {
  const { rows } = await t.db.query<{ conversation_id: string }>(
    `SELECT conversation_id FROM workflow_runs WHERE source = 'agent'`,
  );
  return rows;
};

const DAILY = { enabled: true, every: 1, unit: 'days', from: '09:00', anchor: '2026-11-17' };

describe('spark_workflow', () => {
  it('runs a workflow at once in Bypass permissions, in a new chat', async () => {
    await crew.setRun('bypassPermissions');
    const result = await call('spark_workflow', { action: 'run', workflow: 'Nightly' });
    expect(result.facts).toMatchObject({
      outcome: 'done',
      message: 'Started the Nightly workflow in a new chat.',
    });
    const runs = await agentRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.conversation_id).not.toBe(chat.conversationId);
  });

  it('starts one run for the same card done twice', async () => {
    const action: WorkflowControlAction = {
      action: 'workflow_control',
      op: 'run',
      workflowId: 'nightly',
      name: 'Nightly',
      message: '',
      project: null,
      messageId: newId(),
    };
    await controlWorkflow({ db: t.db, workspaceId: t.workspaceId }, action);
    await controlWorkflow({ db: t.db, workspaceId: t.workspaceId }, action);
    expect(await agentRuns()).toHaveLength(1);
  });

  it('asks in Manual and saves the schedule after Allow', async () => {
    const result = await call('spark_workflow', {
      action: 'schedule',
      workflow: 'nightly',
      schedule: DAILY,
    });
    expect(result.text).toContain('waiting_for_user');
    expect((await pendingCard(t)).title).toBe('Schedule the Nightly workflow?');
    await confirmCard(t);
    expect((await getSchedule(t.db, t.workspaceId, 'nightly'))?.schedule).toMatchObject({
      every: 1,
      unit: 'days',
    });
  });

  it('asks in Auto after the turn read a web page', async () => {
    await crew.setRun('auto');
    await recordObservation(t.db, chat.runId, { source: 'web_page', label: 'web page (a.com)' });
    const result = await call('spark_workflow', { action: 'run', workflow: 'nightly' });
    expect(result.facts.outcome).toBe('waiting_for_user');
  });

  it('saves triggers at once in Bypass permissions', async () => {
    await crew.setRun('bypassPermissions');
    const result = await call('spark_workflow', {
      action: 'triggers',
      workflow: 'nightly',
      triggers: { commit: true },
    });
    expect(result.facts.outcome).toBe('done');
    expect((await getTriggers(t.db, t.workspaceId, 'nightly'))?.triggers.commit).toBe(true);
  });

  it('refuses to run a workflow from a turn a workflow started', async () => {
    await crew.setRun('bypassPermissions', 'workflow');
    const result = await call('spark_workflow', { action: 'run', workflow: 'nightly' });
    expect(result.text).toContain('A turn a workflow started does not run workflows');
    expect(await agentRuns()).toHaveLength(0);
  });

  it('names the workflows when one is not found, and checks a schedule', async () => {
    const missing = await call('spark_workflow', { action: 'run', workflow: 'weekly' });
    expect(missing.text).toContain('Workflows: Nightly (nightly)');
    const bad = await call('spark_workflow', {
      action: 'schedule',
      workflow: 'nightly',
      schedule: { every: 0 },
    });
    expect(bad.text).toContain('Check schedule');
  });
});
