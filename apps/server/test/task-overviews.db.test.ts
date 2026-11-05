import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertApproval } from '../src/persistence/approvals.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import type { Queryable } from '../src/persistence/db.ts';
import { getRun } from '../src/persistence/runs.ts';
import { getTaskDetail } from '../src/persistence/task-views.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;

beforeEach(async () => {
  t = await createTestDb();
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
  });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

async function finishedTask(conversationId: string, content: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake', model: 'fake-fast', effort: 'low' },
  );
  await eventually(async () => (await getRun(t.db, sent.run.id))?.finishedAt);
  const { rows } = await t.db.query<{ task_id: string }>(
    `UPDATE tasks SET status = 'closed', closed_at = now()
     WHERE id = (SELECT task_id FROM runs WHERE id = $1) RETURNING id AS task_id`,
    [sent.run.id],
  );
  return { runId: sent.run.id, taskId: rows[0]!.task_id };
}

async function chatWithTasks(count: number) {
  const conversationId = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
  const tasks: { runId: string; taskId: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    tasks.push(await finishedTask(conversationId, `Fix thing ${index} #plan`));
  }
  return { conversationId, tasks };
}

function counting(db: Queryable): { db: Queryable; count: () => number } {
  let queries = 0;
  const query = ((...args: unknown[]) => {
    queries += 1;
    return (db.query as (...inner: unknown[]) => unknown)(...args);
  }) as Queryable['query'];
  return { db: { query }, count: () => queries };
}

function checkBody(runId: string) {
  return {
    runId,
    name: 'Bolt',
    copy: null,
    round: 1,
    status: 'failed',
    results: [
      {
        command: 'pnpm test',
        kind: 'test',
        outcome: 'failed',
        exitCode: 1,
        durationMs: 12,
        outputTail: 'expected one to equal two',
        truncated: false,
        note: null,
        approvalId: null,
      },
    ],
  };
}

describe('task overviews in a chat', () => {
  it('reads a chat with many tasks in as many queries as a chat with one', async () => {
    const one = await chatWithTasks(1);
    const many = await chatWithTasks(4);
    const single = counting(t.db);
    const batch = counting(t.db);
    expect((await getConversationDetail(single.db, one.conversationId))?.tasks).toHaveLength(1);
    expect((await getConversationDetail(batch.db, many.conversationId))?.tasks).toHaveLength(4);
    expect(batch.count()).toBe(single.count());
  });

  it('keeps each task its own plan and approvals, and drops old check rows', async () => {
    const { conversationId, tasks } = await chatWithTasks(3);
    const second = tasks[1]!;
    const third = tasks[2]!;
    await insertApproval(
      t.db,
      {
        runId: second.runId,
        toolCallId: 'call-1',
        rpcId: null,
        kind: 'execute',
        title: 'Run the deploy script',
        payload: { command: './deploy.sh', cwd: null, paths: [], diffs: [], truncated: false },
        options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
        reason: null,
      },
      { status: 'allowed', decidedBy: 'user', optionId: 'allow' },
    );
    await t.db.query(
      `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
       VALUES ($1, 'check', 1, $2, $3)`,
      [third.taskId, JSON.stringify(checkBody(third.runId)), third.runId],
    );

    const detail = await getConversationDetail(t.db, conversationId);
    const overviews = detail?.tasks ?? [];
    expect(overviews.map((task) => task.id)).toEqual(tasks.map((task) => task.taskId));
    expect(overviews.map((task) => task.runIds)).toEqual(tasks.map((task) => [task.runId]));
    expect(overviews.map((task) => task.planVersion)).toEqual([1, 1, 1]);

    const waiting = (index: number) =>
      overviews[index]!.recorded.filter((item) => item.label === 'Run the deploy script');
    expect(waiting(0)).toEqual([]);
    expect(waiting(1)).toMatchObject([{ detail: 'Allowed: Allow once' }]);
    expect(waiting(2)).toEqual([]);
    expect(overviews[2]!.recorded).toEqual([]);

    for (const [index, task] of tasks.entries()) {
      const single = await getTaskDetail(t.db, task.taskId);
      expect(single).toMatchObject(overviews[index]!);
    }
  });
});
