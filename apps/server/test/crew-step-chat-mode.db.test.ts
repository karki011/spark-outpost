import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CrewSpark } from '@spark-outpost/contracts';
import { resolveRunTarget } from '../src/api/run-target.ts';
import { startWorkflowRun, type StartRun } from '../src/crew-flows/start-run.ts';
import { runsInChat } from '../src/crew-flows/step-sparks.ts';
import { workflowStore } from '../src/crew-flows/workflow-store.ts';
import { resolveChatSettings, updateChatSettings } from '../src/persistence/chat-settings.ts';
import { insertChildRun } from '../src/persistence/orchestrations.ts';
import { actionFacts, actionPath } from '../src/spark-mcp/actions/action-policy.ts';
import type { Worker } from '../src/workflow/worker.ts';
import {
  newSpark,
  recordOf,
  saveFlow,
  step,
  stepReply,
  useWorkflowsDir,
} from './crew-workflow-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import {
  allowOnce,
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
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

const deps = () => ({
  db: t.db,
  workspaceId: t.workspaceId,
  store: workflowStore(),
  runTarget: (conversationId: string) =>
    resolveRunTarget({ db: t.db, workspaceId: t.workspaceId }, conversationId),
});

async function chatIn(agentMode: string): Promise<string> {
  const conversationId = await openChat(t, { root });
  await updateChatSettings(t.db, conversationId, { provider: 'claude', agentMode });
  return conversationId;
}

function start(extra: Partial<StartRun> & Pick<StartRun, 'source'>): StartRun {
  return {
    kind: 'run',
    workflowId: 'probe',
    messageId: randomUUID(),
    conversationId: null,
    projectId: null,
    message: '',
    ...extra,
  };
}

async function saveProbe() {
  const pip = await newSpark(t, 'Pip');
  await saveFlow(t, 'probe', [
    step('look', pip.id, { prompt: 'Read the pull request. #command `gh pr view 12`' }),
    step('push', pip.id, { prompt: 'Publish it. #command `git push origin main`' }),
  ]);
}

async function triggeredIn(conversationId: string) {
  harness = startTurnWorker(t);
  const run = await startWorkflowRun(deps(), start({ source: 'trigger', conversationId }));
  const { asked } = await driveToEnd(t, conversationId, run.runId!, allowOnce, 120_000);
  return { asked, record: await recordOf(t, run.runId!) };
}

async function stepSpark(runId: string): Promise<{ agent_mode: string; spark: CrewSpark }> {
  const { rows } = await t.db.query<{ agent_mode: string; spark: CrewSpark }>(
    `SELECT agent_mode, route->'spark' AS spark FROM runs WHERE id = $1`,
    [runId],
  );
  return rows[0]!;
}

describe('a Spark on Default agent and Default mode in a chat', () => {
  it('runs a read command at once in a Bypass chat, and is still refused a push', async () => {
    await saveProbe();
    const conversationId = await chatIn('bypassPermissions');

    const { asked, record } = await triggeredIn(conversationId);

    expect(asked).toEqual([]);
    expect(await stepReply(t, record, 'look')).toContain('permission=yes');
    expect(await stepReply(t, record, 'push')).toContain('permission=no');
    const look = await stepSpark(record!.steps[0]!.runId!);
    expect(look.agent_mode).toBe('bypassPermissions');
    expect(look.spark).toMatchObject({
      agentMode: 'bypassPermissions',
      agentFrom: 'chat',
      modeFrom: 'chat',
    });
  }, 240_000);

  it('still asks in a Manual chat', async () => {
    await saveProbe();
    const conversationId = await chatIn('default');

    const { asked, record } = await triggeredIn(conversationId);

    expect(asked.map((card) => card.runId)).toEqual([record!.steps[0]!.runId]);
    expect(await stepReply(t, record, 'push')).toContain('permission=no');
  }, 240_000);
});

describe('where a step’s inherited settings come from', () => {
  async function readOnlyStepIn(agentMode: string): Promise<string> {
    const conversationId = await chatIn(agentMode);
    const parent = await sendMessage(t, conversationId, 'go', { agentMode });
    const lease = await insertChildRun(
      t.db,
      {
        parentRunId: parent,
        role: 'spark',
        stepIndex: 0,
        attempt: 1,
        agentLabel: 'Pip',
        provider: 'claude',
        model: null,
        effort: null,
        mode: 'ask',
        level: 'hands-off',
        prompt: 'Read the ticket.',
        agentMode,
        route: { name: 'Pip', routedBy: 'fixed' },
      },
      30,
    );
    await t.db.query(`UPDATE runs SET used_mode = 'read-only' WHERE id = $1`, [lease.runId]);
    return lease.runId;
  }

  it('follows the step’s own mode for Spark read tools, not its read-only session', async () => {
    const runId = await readOnlyStepIn('bypassPermissions');

    expect((await actionFacts(t.db, runId, 'atlassian_read')).posture).toBe('full_access');
    expect(actionPath(await actionFacts(t.db, runId, 'atlassian_read'))).toBe('perform');
    expect(actionPath(await actionFacts(t.db, runId, 'calendar_read'))).toBe('perform');
  });

  it('still asks before a step in a Bypass chat uses a Spark tool that acts or sends', async () => {
    const runId = await readOnlyStepIn('bypassPermissions');

    for (const action of ['jira_edit', 'post_slack', 'servicenow_edit', 'act_page'] as const) {
      expect(actionPath(await actionFacts(t.db, runId, action))).toBe('confirm');
    }
  });

  it('gives a workflow an agent starts the calling chat’s agent and mode', async () => {
    await saveProbe();
    const caller = await chatIn('bypassPermissions');

    const run = await startWorkflowRun(deps(), start({ source: 'agent', settingsFrom: caller }));

    const made = await resolveChatSettings(t.db, run.conversationId!);
    expect(made).toMatchObject({ provider: 'claude', agentMode: 'bypassPermissions' });
    const { rows } = await t.db.query<{ agent_mode: string }>(
      'SELECT agent_mode FROM runs WHERE id = $1',
      [run.runId],
    );
    expect(rows[0]?.agent_mode).toBe('bypassPermissions');
    expect(await runsInChat(t.db, { run })).toBe(true);
  });

  it('gives a step in a new chat your default as it is when the step starts', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'probe', [step('look', pip.id, { prompt: 'Say hello.' })]);
    const run = await startWorkflowRun(deps(), start({ source: 'manual' }));
    await t.db.query(
      `UPDATE provider_connections SET agent_mode = 'acceptEdits'
       WHERE workspace_id = $1 AND provider = 'claude'`,
      [t.workspaceId],
    );

    harness = startTurnWorker(t);
    await driveToEnd(t, run.conversationId!, run.runId!, allowOnce, 120_000);

    const record = await recordOf(t, run.runId!);
    const look = await stepSpark(record!.steps[0]!.runId!);
    expect(look.agent_mode).toBe('acceptEdits');
    expect(look.spark).toMatchObject({ modeFrom: 'default', agentFrom: 'default' });
  }, 240_000);

  it('uses your default for a run in a new chat, and the chat’s for a run in an existing one', async () => {
    await saveProbe();
    const fresh = await startWorkflowRun(deps(), start({ source: 'manual' }));
    expect(await runsInChat(t.db, { run: fresh })).toBe(false);

    const conversationId = await chatIn('bypassPermissions');
    await sendMessage(t, conversationId, 'Earlier message.');
    const existing = await startWorkflowRun(deps(), start({ source: 'manual', conversationId }));
    expect(await runsInChat(t.db, { run: existing })).toBe(true);
    expect(await runsInChat(t.db, { run: { ...existing, kind: 'review' } })).toBe(false);
  });
});
