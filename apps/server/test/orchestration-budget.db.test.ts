import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import {
  COMPLEX,
  RISKY,
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

const COST_CAP = 0.1;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

function start(costCapUsd?: number, scenario = COMPLEX) {
  const script: JevScript = { calls: [], scenario };
  harness = startOrchestrator(
    t,
    jevFetch(script),
    costCapUsd === undefined ? {} : { budget: { costCapUsd } },
  );
}

function begin(tag: string, scenario = COMPLEX) {
  return startScenario(t, root, withTag(scenario, tag), 'hands-off');
}

interface Member {
  runId: string;
  role: string;
  status: string;
  costUsd: number | null;
  costSource: string | null;
}

async function members(runId: string): Promise<Member[]> {
  const { rows } = await t.db.query<{
    id: string;
    role: string;
    status: string;
    cost_usd: string | null;
    cost_source: string | null;
  }>(
    `SELECT id, role, status, cost_usd, cost_source FROM runs
     WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => ({
    runId: row.id,
    role: row.role,
    status: row.status,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    costSource: row.cost_source,
  }));
}

const stopAtBudget: Answerer = (approval) =>
  approval.kind === 'budget' ? { optionId: CHECKPOINT_OPTION.stop } : answerEverything(approval);

describe('cost cap', () => {
  it('stops a Builder mid-turn once its estimated spend crosses the cap', async () => {
    start(COST_CAP);
    const { conversationId, runId } = await begin('#spend');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, stopAtBudget);
    expect(asked.map((approval) => approval.kind)).toEqual(['budget']);
    const budget = asked[0]!.payload.checkpoint?.budget;
    expect(budget).toMatchObject({ limit: 'cost', allowed: COST_CAP });
    expect(budget!.used).toBeGreaterThanOrEqual(COST_CAP);
    expect(orchestration).toMatchObject({ status: 'failed', budget: { exceeded: 'cost' } });
    const [builder, ...rest] = await members(runId);
    expect(rest).toEqual([]);
    expect(builder).toMatchObject({
      role: 'builder',
      status: 'cancelled',
      costSource: 'estimated',
    });
    expect(builder!.costUsd).toBeGreaterThanOrEqual(COST_CAP);
    expect(builder!.costUsd).toBeLessThan(COST_CAP * 1.5);
  }, 60_000);

  it('stops a Builder at the spend cap saved in Settings, with no server cap', async () => {
    start();
    await updateProfile(t.db, t.workspaceId, { spendCapUsd: COST_CAP });
    const { conversationId, runId } = await begin('#spend');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, stopAtBudget);
    expect(asked.map((approval) => approval.kind)).toEqual(['budget']);
    expect(orchestration.budget).toMatchObject({ exceeded: 'cost', costCapUsd: COST_CAP });
  }, 60_000);

  it('runs past the server cap when the saved spend cap is Off', async () => {
    start(COST_CAP, RISKY);
    await updateProfile(t.db, t.workspaceId, { spendCapUsd: null });
    const { conversationId, runId } = await begin('#cost', RISKY);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, stopAtBudget);
    expect(asked.map((approval) => approval.kind)).not.toContain('budget');
    expect(orchestration.budget).toMatchObject({ exceeded: null, costCapUsd: null });
  }, 60_000);

  it('asks before the next step instead of starting it over the cap', async () => {
    start(COST_CAP, RISKY);
    const { conversationId, runId } = await begin('#cost', RISKY);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, stopAtBudget);
    expect(asked.map((approval) => approval.kind)).toEqual(['budget']);
    expect(orchestration.budget.exceeded).toBe('cost');
    expect((await members(runId)).map((member) => member.role)).toEqual(['builder']);
  }, 60_000);
});

async function slowSnapshots(): Promise<void> {
  await writeFile(join(root, '.gitattributes'), '*.slow filter=slow\n');
  await writeFile(join(root, 'wait.slow'), 'wait\n');
  execFileSync('git', ['-C', root, 'config', 'filter.slow.clean', 'sleep 1; cat']);
}

describe('stop', () => {
  it('stops a Builder whose spawn was still being prepared when you pressed Stop', async () => {
    start();
    await slowSnapshots();
    const { conversationId, runId } = await begin('#slowbuild');
    await eventually(async () => {
      const view = await loadOrchestration(t.db, runId);
      return view?.phase === 'building' && (await members(runId)).length === 0;
    }, 30_000);
    await requestCancel(t.db, runId);
    const { orchestration } = await driveToEnd(t, conversationId, runId, answerEverything, 20_000);
    expect(orchestration.status).toBe('cancelled');
    const spawned = await members(runId);
    expect(spawned.map((member) => [member.role, member.status])).toEqual([
      ['builder', 'cancelled'],
    ]);
  }, 60_000);

  it('records the estimated spend of a Builder stopped mid-turn', async () => {
    start();
    const { conversationId, runId } = await begin('#spend');
    await eventually(async () => {
      const view = await loadOrchestration(t.db, runId);
      return view && view.budget.toolCalls >= 3 ? view : null;
    }, 30_000);
    await requestCancel(t.db, runId);
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('cancelled');
    const [builder] = await members(runId);
    expect(builder).toMatchObject({ status: 'cancelled', costSource: 'estimated' });
    expect(builder!.costUsd).toBeGreaterThan(0);
  }, 60_000);
});
