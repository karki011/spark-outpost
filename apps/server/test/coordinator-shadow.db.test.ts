import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertPlanDocument } from '../src/persistence/plan-documents.ts';
import {
  NORMAL,
  TRIVIAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const PLAN = `# Project budgets
1. Store budgets in \`apps/server/src/persistence/budgets.ts\`
2. Serve them from \`apps/server/src/api/budgets.ts\`
3. Show a bar in \`apps/web/src/projects/BudgetBar.tsx\`
4. Add a column in \`apps/web/src/analytics/export.ts\``;

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

async function shadowRows(runId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await t.db.query<{ answer: Record<string, unknown>; policy: string }>(
    `SELECT body->'answer' AS answer, policy_version AS policy FROM run_advice
     WHERE run_id = $1 AND purpose = 'parallel'`,
    [runId],
  );
  return rows.map((row) => ({ ...row.answer, policy: row.policy }));
}

async function run(scenario: Scenario, plan: string | null = null) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }), { coordinator: 'shadow' });
  const approve = async (conversationId: string) => {
    if (!plan) return;
    await insertPlanDocument(t.db, {
      conversationId,
      taskId: null,
      source: 'chat',
      body: plan,
      sourceRunId: null,
      approval: { by: 'user', option: null, runId: null, commit: null },
    });
  };
  const { conversationId, runId } = await startScenario(
    t,
    root,
    scenario,
    'hands-off',
    'auto',
    'sonnet',
    'acceptEdits',
    approve,
  );
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  return { runId, orchestration };
}

describe('coordinator shadow', () => {
  it('records that a planned build across two areas would be coordinated, without changing it', async () => {
    const { runId, orchestration } = await run(NORMAL, PLAN);
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.crew.map((member) => member.role)).not.toContain('coordinator');
    expect(orchestration.decisions.map((decision) => decision.kind)).not.toContain('parallel');
    expect(await shadowRows(runId)).toEqual([
      expect.objectContaining({
        shadow: true,
        engage: true,
        reason: 'plan',
        detail: 'the agreed plan has 4 open items in 2 areas',
        placement: 'in_order',
        planItems: 4,
        policy: 'coord-4',
      }),
    ]);
  }, 60_000);

  it('records a story that fits one Builder as not engaged', async () => {
    const { runId } = await run(withTag(NORMAL, '#story'));
    expect(await shadowRows(runId)).toEqual([
      expect.objectContaining({ shadow: true, engage: false, reason: null, placement: null }),
    ]);
  }, 60_000);

  it('records a story that asks to be split up as requested', async () => {
    const { runId } = await run(withTag(NORMAL, 'Split this up. #story'));
    expect(await shadowRows(runId)).toEqual([
      expect.objectContaining({ engage: true, reason: 'requested' }),
    ]);
  }, 60_000);

  it('records nothing for a one-liner', async () => {
    const { runId } = await run(TRIVIAL);
    expect(await shadowRows(runId)).toEqual([]);
  }, 60_000);
});
