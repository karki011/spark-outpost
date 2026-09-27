import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type PlanVersion } from '@spark-outpost/contracts';
import { planVersions } from '../src/persistence/artifacts.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { getTaskDetail } from '../src/persistence/task-views.ts';
import {
  SCENARIOS,
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  planWrites,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const COMPLEX = SCENARIOS[3] as Scenario;

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  script = { calls: [], scenario: COMPLEX };
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch(script));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

const retryFailures: JevScript['transition'] = (state) =>
  state.outcome === 'failed'
    ? { status: 'needs_more_work', next: 'retry_up' }
    : { status: 'done', next: 'next_step' };

async function run(tags: string, answer: Answerer = answerEverything) {
  const scenario = { ...COMPLEX, text: `${COMPLEX.text} ${tags}`.trim() };
  const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
  const result = await driveToEnd(t, conversationId, runId, answer);
  const { rows } = await t.db.query<{ task_id: string }>('SELECT task_id FROM runs WHERE id = $1', [
    runId,
  ]);
  const taskId = rows[0]!.task_id;
  return { ...result, conversationId, runId, taskId, versions: await planVersions(t.db, taskId) };
}

const statuses = (versions: readonly PlanVersion[]) =>
  versions.map((version) => version.body.entries.map((entry) => entry.status).join(' '));

async function builderRuns(runId: string): Promise<{ id: string; step: number }[]> {
  const { rows } = await t.db.query<{ id: string; step_index: number }>(
    `SELECT id, step_index FROM runs WHERE parent_run_id = $1 AND role = 'builder'
     ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => ({ id: row.id, step: row.step_index }));
}

describe('plan progress', () => {
  it('ticks every step as the one Builder carrying the plan marks it done', async () => {
    const { versions, runId, taskId, orchestration } = await run('');
    expect(orchestration.status).toBe('succeeded');
    expect(await planWrites(t, runId)).toEqual([
      'pending pending pending',
      'in_progress pending pending',
      'completed in_progress pending',
      'completed completed in_progress',
      'completed completed completed',
    ]);
    expect(versions.map((version) => version.version)).toEqual([1]);
    expect(statuses(versions)).toEqual(['completed completed completed']);
    expect(orchestration.planVersion).toBe(1);
    const builders = await builderRuns(runId);
    expect(builders.map((builder) => builder.step)).toEqual([0]);
    expect(versions[0]!.sourceRunId).toBe(builders[0]!.id);
    expect(versions[0]!.usedBy).toContain(builders[0]!.id);

    const task = await getTaskDetail(t.db, taskId);
    const planned = task?.items.filter((item) => item.id.startsWith('plan:')) ?? [];
    expect(planned).toEqual([]);
    expect(task?.items.filter((item) => item.role === 'builder').map((item) => item.state)).toEqual(
      ['done'],
    );
    expect(task?.items.find((item) => item.id === 'planned')?.role).toBe('architect');
  }, 60_000);

  it('leaves a failed step unfinished when retries run out and you move on', async () => {
    script.transition = retryFailures;
    const answers: Answerer = (approval) =>
      approval.kind === 'retry'
        ? { optionId: CHECKPOINT_OPTION.finish }
        : answerEverything(approval);
    const { versions, asked, orchestration, runId } = await run('#failstep 2', answers);
    expect(asked.map((approval) => approval.kind)).toEqual(['retry']);
    expect(orchestration.retries).toBe(2);
    expect(await planWrites(t, runId)).toEqual([
      'pending pending pending',
      'in_progress pending pending',
      'completed in_progress pending',
      'completed failed pending',
      'completed in_progress pending',
      'completed failed pending',
      'completed in_progress pending',
      'completed failed pending',
    ]);
    expect(versions.map((version) => [version.version, version.supersededBy])).toEqual([[1, null]]);
  }, 60_000);

  it('retries from the failed step and carries the rest in the same Builder', async () => {
    script.transition = retryFailures;
    const { versions, runId, orchestration } = await run('#failonce 2');
    expect(orchestration.status).toBe('succeeded');
    expect(await planWrites(t, runId)).toEqual([
      'pending pending pending',
      'in_progress pending pending',
      'completed in_progress pending',
      'completed failed pending',
      'completed in_progress pending',
      'completed completed in_progress',
      'completed completed completed',
    ]);
    const builders = await builderRuns(runId);
    expect(builders.map((builder) => builder.step)).toEqual([0, 1]);
    expect(statuses(versions)).toEqual(['completed completed completed']);
    expect(versions[0]!.sourceRunId).toBe(builders[1]!.id);
  }, 60_000);

  it("counts plan versions per revision, not per Builder's own todos or progress", async () => {
    const first = await run('#todos');
    expect(first.orchestration.status).toBe('succeeded');
    expect(first.versions.map((version) => version.version)).toEqual([1]);
    const { rows: todos } = await t.db.query(
      `SELECT 1 FROM run_events e JOIN runs r ON r.id = e.run_id
       WHERE r.parent_run_id = $1 AND e.payload->>'activityType' = 'plan'
         AND e.payload::text LIKE '%My todo%'`,
      [first.runId],
    );
    expect(todos).toEqual([]);
    expect(first.versions[0]!.body.entries.map((entry) => entry.content)).toEqual([
      'Update src/dates.ts for step 1',
      'Update src/divider.tsx for step 2',
      'Update src/turns.ts for step 3',
    ]);

    const sent = await sendUserMessage(
      t.db,
      first.conversationId,
      { id: randomUUID(), content: `${COMPLEX.text} #revise` },
      {
        provider: 'claude',
        model: 'sonnet',
        effort: 'medium',
        permission: 'do',
        level: 'hands-off',
      },
    );
    const second = await driveToEnd(t, first.conversationId, sent.run.id);
    expect(second.orchestration.status).toBe('succeeded');
    expect(second.orchestration.planVersion).toBe(2);
    const versions = await planVersions(t.db, first.taskId);
    expect(versions.map((version) => [version.version, version.supersededBy])).toEqual([
      [1, 2],
      [2, null],
    ]);
    expect(statuses(versions)).toEqual([
      'completed completed completed',
      'completed completed completed',
    ]);
  }, 90_000);
});
