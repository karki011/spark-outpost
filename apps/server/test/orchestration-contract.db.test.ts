import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APPROVAL_DECIDED,
  APPROVAL_REQUESTED,
  CHECKPOINT_OPTION,
  type Approval,
} from '@spark-outpost/contracts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, listConversations } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { getTaskDetail } from '../src/persistence/task-views.ts';
import {
  SCENARIOS,
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const [, TRIVIAL, , COMPLEX] = SCENARIOS as [Scenario, Scenario, Scenario, Scenario, Scenario];

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  script = { calls: [] };
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch(script));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function pendingApproval(conversationId: string, kind: Approval['kind']) {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    return detail?.approvals.find((item) => item.kind === kind && item.status === 'pending');
  }, 30_000);
}

async function approvalEvents(runId: string) {
  const { rows } = await t.db.query<{ name: string; id: string }>(
    `SELECT payload->>'name' AS name, payload->'value'->>'id' AS id FROM run_events
     WHERE run_id = $1 AND type = 'CUSTOM' ORDER BY seq`,
    [runId],
  );
  return rows;
}

describe('clarify in your own words', () => {
  it('needs a note, then works on the request with the answer added', async () => {
    const unsure = { ...TRIVIAL, confidence: 0.5 };
    script.scenario = unsure;
    const { conversationId, runId } = await startScenario(t, root, unsure, 'balanced');
    const clarify = await pendingApproval(conversationId, 'clarify');
    expect(clarify.options.map((option) => option.optionId)).toContain(CHECKPOINT_OPTION.answer);
    await expect(
      decideApproval(t.db, t.workspaceId, clarify.id, {
        optionId: CHECKPOINT_OPTION.answer,
        scope: 'once',
      }),
    ).rejects.toThrow('This answer needs a note.');

    const answers: Answerer = (approval) =>
      approval.kind === 'clarify'
        ? { optionId: CHECKPOINT_OPTION.answer, note: 'Only the heading' }
        : answerEverything(approval);
    const { orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(orchestration).toMatchObject({
      status: 'succeeded',
      depth: 'execute',
      depthSource: 'rules',
    });
    expect(orchestration.checkpoints[0]).toMatchObject({
      decisionOptionId: CHECKPOINT_OPTION.answer,
      note: 'Only the heading',
    });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.messages.at(-1)?.content).toContain('Clarified: Only the heading');
  }, 60_000);
});

describe('a Builder waiting on an edit', () => {
  it('marks the chat as needing input and mirrors the approval on the orchestration stream', async () => {
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'balanced');
    const plan = await pendingApproval(conversationId, 'plan');
    const [planning] = await listConversations(t.db, t.workspaceId);
    expect(planning?.attention).toMatchObject({
      kind: 'plan',
      agentName: 'Sketch',
      approvalId: plan.id,
    });
    await decideApproval(t.db, t.workspaceId, plan.id, {
      optionId: CHECKPOINT_OPTION.approvePlan,
      scope: 'once',
    });
    const edit = await pendingApproval(conversationId, 'edit');
    expect(edit.runId).not.toBe(runId);
    expect((await getRun(t.db, runId))?.status).toBe('running');
    const [chat] = await listConversations(t.db, t.workspaceId);
    expect(chat).toMatchObject({
      id: conversationId,
      needsInput: true,
      attention: { kind: 'permission', agentName: 'Bolt', approvalId: edit.id },
    });
    expect(await approvalEvents(runId)).toContainEqual({ name: APPROVAL_REQUESTED, id: edit.id });

    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(await approvalEvents(runId)).toContainEqual({ name: APPROVAL_DECIDED, id: edit.id });
    const [done] = await listConversations(t.db, t.workspaceId);
    expect(done).toMatchObject({ needsInput: false, attention: null });

    expect(orchestration.crew.map((member) => member.name)).toEqual(['Sketch', 'Bolt', 'Hawk']);
    expect(orchestration.crew[1]?.agentLabel).toBe('Bolt · Builder · Sonnet 5 · medium');
    expect(orchestration.totals.jevTokens).toBe(1000 * orchestration.totals.jevCalls);
    const task = await getTaskDetail(t.db, orchestration.taskId!);
    const critic = orchestration.crew.at(-1)!;
    expect(task?.items.find((item) => item.runId === critic.runId)).toMatchObject({
      role: 'critic',
      name: 'Hawk',
    });
    expect(task?.items.find((item) => item.id === 'planned')).toMatchObject({
      role: 'architect',
    });
  }, 60_000);
});
