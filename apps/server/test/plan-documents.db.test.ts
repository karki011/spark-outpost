import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { taskDetailSchema } from '@spark-outpost/contracts';
import { createConversation } from '../src/persistence/conversations.ts';
import {
  approvePlanDocument,
  conversationPlans,
  insertPlanDocument,
  latestApprovedPlan,
  planDocuments,
  rejectPlanDocument,
} from '../src/persistence/plan-documents.ts';
import { saveAgreedMessage } from '../src/plans/agreed-plans.ts';
import { staleFiles } from '../src/plans/plan-staleness.ts';
import { headCommit } from '../src/projects/snapshot.ts';
import { PLAN_SAVE_FAILED, createPlanRecorder } from '../src/workflow/plan-recorder.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { linkedConversation, recordingAppend, sendDo } from './approval-support.ts';
import { gitRepo, removeRepo } from './turn-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

async function trackedDoc(root: string): Promise<void> {
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs/notes.txt'), 'start\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', [
    '-C',
    root,
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    'commit',
    '-qm',
    'docs',
  ]);
}

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function conversation(): Promise<string> {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

const approval = { by: 'user' as const, option: 'exit-plan-default', runId: null, commit: 'c1' };

function proposal(conversationId: string, body = '# Plan\n1. Do it') {
  return {
    conversationId,
    taskId: null,
    source: 'claude_plan_mode' as const,
    body,
    sourceRunId: null,
  };
}

describe('plan documents', () => {
  it('numbers versions per conversation and keeps one approved plan at a time', async () => {
    const id = await conversation();
    const first = await insertPlanDocument(t.db, { ...proposal(id), approval });
    const second = await insertPlanDocument(t.db, proposal(id, '# Plan 2'));
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(second.status).toBe('proposed');
    const approved = await approvePlanDocument(t.db, second.id, approval);
    expect(approved).toMatchObject({ status: 'approved', approvedCommit: 'c1' });
    expect((await planDocuments(t.db, id)).map((plan) => plan.status)).toEqual([
      'superseded',
      'approved',
    ]);
    expect((await latestApprovedPlan(t.db, id))?.id).toBe(second.id);
  });

  it('only approves or rejects a plan that is still proposed, and refuses empty plans', async () => {
    const id = await conversation();
    const plan = await insertPlanDocument(t.db, proposal(id));
    await rejectPlanDocument(t.db, plan.id, null);
    await expect(approvePlanDocument(t.db, plan.id, approval)).rejects.toThrow('no longer waiting');
    await expect(insertPlanDocument(t.db, proposal(id, '   '))).rejects.toThrow('needs some text');
  });

  it('surfaces a failed save in the work log instead of skipping it', async () => {
    const recorded = recordingAppend();
    const recorder = createPlanRecorder({
      db: t.db,
      runId: randomUUID(),
      conversationId: randomUUID(),
      root: null,
      taskId: async () => null,
      append: recorded.append,
    });
    expect(await recorder.propose('# Plan', 'codex')).toBeNull();
    const steps = recorded.events.flatMap(({ event }) =>
      event.type === 'STEP_STARTED' ? [event.stepName] : [],
    );
    expect(steps).toEqual([expect.stringContaining(PLAN_SAVE_FAILED)]);
  });
});

describe('stale agreed plans', () => {
  let root: string;

  beforeEach(async () => {
    root = await gitRepo();
  });

  afterEach(() => removeRepo(root));

  it('lists the named files that changed since the approval commit', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    await trackedDoc(root);
    const id = await conversation();
    const commit = await headCommit(root);
    const plan = await insertPlanDocument(t.db, {
      ...proposal(id, '1. Update docs/notes.txt\n2. Leave README.md alone'),
      approval: { ...approval, commit },
    });
    expect(await staleFiles(root, plan)).toEqual([]);
    await writeFile(join(root, 'docs/notes.txt'), 'changed\n');
    expect(await staleFiles(root, plan)).toEqual(['docs/notes.txt']);
    git('commit', '-qam', 'later');
    expect(await staleFiles(root, plan)).toEqual(['docs/notes.txt']);
    expect(await staleFiles(null, plan)).toEqual([]);
  });
});

describe('a reply agreed as the plan', () => {
  let root: string;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    root = await gitRepo();
    app = createTestApp(t);
  });

  afterEach(() => removeRepo(root));

  async function reply(conversationId: string, content: string) {
    const runId = await sendDo(t, conversationId, 'Plan it');
    const messageId = randomUUID();
    await t.db.query(
      `INSERT INTO messages (id, conversation_id, role, content, run_id)
       VALUES ($1, $2, 'assistant', $3, $4)`,
      [messageId, conversationId, content, runId],
    );
    return { id: messageId, conversationId, content, runId, taskId: null };
  }

  it('is saved once, and shows in the task detail', async () => {
    await trackedDoc(root);
    const { conversationId } = await linkedConversation(t, root);
    const message = await reply(conversationId, '## Plan\n1. Edit docs/notes.txt');
    const agreement = { root, approvedRunId: message.runId };
    const saved = await saveAgreedMessage(t.db, message, agreement);
    expect(saved).toMatchObject({
      status: 'approved',
      source: 'chat',
      approvedBy: 'jev',
      sourceMessageId: message.id,
      approvedCommit: await headCommit(root),
    });
    const again = await saveAgreedMessage(t.db, message, agreement);
    expect(again.id).toBe(saved.id);

    const taskId = randomUUID();
    await t.db.query(`INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, 'Plan')`, [
      taskId,
      conversationId,
    ]);
    await t.db.query('UPDATE runs SET task_id = $2 WHERE id = $1', [message.runId, taskId]);
    await writeFile(join(root, 'docs/notes.txt'), 'changed\n');
    const detail = taskDetailSchema.parse(
      (await request(app).get(`/api/tasks/${taskId}`).set(LOCAL_HEADERS).expect(200)).body,
    );
    expect(detail.agreedPlanVersion).toBe(1);
    expect(detail.agreedPlans).toMatchObject({
      documents: [{ id: saved.id }],
      staleFiles: ['docs/notes.txt'],
    });
  });

  it('keeps showing a plan saved by hand in an earlier version', async () => {
    const { conversationId } = await linkedConversation(t, root);
    const message = await reply(conversationId, '## Plan\n1. Edit notes.txt');
    await insertPlanDocument(t.db, {
      conversationId,
      taskId: null,
      source: 'user',
      body: message.content,
      sourceRunId: message.runId,
      sourceMessageId: message.id,
      approval: { by: 'user', option: null, runId: null, commit: null },
    });
    const [plan] = await planDocuments(t.db, conversationId);
    expect(plan).toMatchObject({ status: 'approved', source: 'user', approvedBy: 'user' });
    expect((await conversationPlans(t.db, conversationId)).saved).toEqual([
      { messageId: message.id, version: 1 },
    ]);
  });

  it('has no route that saves a reply as the plan', async () => {
    const { conversationId } = await linkedConversation(t, root);
    const message = await reply(conversationId, '## Plan\n1. Edit notes.txt');
    await request(app)
      .post(`/api/conversations/${conversationId}/plans`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({ messageId: message.id })
      .expect(404);
    expect(await planDocuments(t.db, conversationId)).toEqual([]);
  });
});
