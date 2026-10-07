import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  COMPLEX,
  TRIVIAL,
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Answerer,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

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

describe('a fix request in your own words', () => {
  it('needs a note, then sends the Builder back with the note added', async () => {
    const risky = withTag(TRIVIAL, '#dropmigration');
    const { conversationId, runId } = await startScenario(t, root, risky, 'hands-off');
    const keep = await pendingApproval(conversationId, 'accept');
    expect(keep.options.map((option) => option.optionId)).toContain(CHECKPOINT_OPTION.fix);
    await expect(
      decideApproval(t.db, t.workspaceId, keep.id, {
        optionId: CHECKPOINT_OPTION.fix,
        scope: 'once',
      }),
    ).rejects.toThrow('This answer needs a note.');

    let fixed = false;
    const answers: Answerer = (approval) => {
      if (approval.kind !== 'accept') return answerEverything(approval);
      if (fixed) return { optionId: CHECKPOINT_OPTION.keep };
      fixed = true;
      return { optionId: CHECKPOINT_OPTION.fix, note: 'Use UTC' };
    };
    const { orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(orchestration).toMatchObject({ status: 'succeeded', depth: 'execute' });
    expect(orchestration.checkpoints[0]).toMatchObject({
      id: keep.id,
      decisionOptionId: CHECKPOINT_OPTION.fix,
      note: 'Use UTC',
    });
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toContain('fixed as asked');
  }, 60_000);
});

describe('a Builder waiting on an edit', () => {
  it('marks the chat as needing input and mirrors the approval on the orchestration stream', async () => {
    const reviewed = { ...COMPLEX, review: 0.95 };
    script.scenario = reviewed;
    const { conversationId, runId } = await startScenario(t, root, reviewed, null);
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

    expect(orchestration.crew.map((member) => member.name)).toEqual(['Bolt', 'Hawk']);
    expect(orchestration.crew[0]?.agentLabel).toBe('Bolt · Builder · Opus 5.5 · medium');
    expect(orchestration.totals.jevTokens).toBe(1000 * orchestration.totals.jevCalls);
    const task = await getTaskDetail(t.db, orchestration.taskId!);
    const critic = orchestration.crew.at(-1)!;
    expect(task?.items.find((item) => item.runId === critic.runId)).toMatchObject({
      role: 'critic',
      name: 'Hawk',
    });
  }, 60_000);
});
