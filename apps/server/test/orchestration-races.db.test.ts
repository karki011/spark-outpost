import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { METER_CALL_USD } from './fake-acp-roles.ts';
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
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const SLOW_POLL_MS = 3_000;
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

async function builderCost(runId: string): Promise<{ status: string; cost: number }> {
  const { rows } = await t.db.query<{ status: string; cost_usd: string | null }>(
    `SELECT status, cost_usd FROM runs WHERE parent_run_id = $1 AND role = 'builder'
     ORDER BY created_at LIMIT 1`,
    [runId],
  );
  return { status: rows[0]!.status, cost: Number(rows[0]!.cost_usd ?? 0) };
}

const stopAtCard: Answerer = (approval) =>
  approval.kind === 'budget' || approval.kind === 'stuck'
    ? { optionId: CHECKPOINT_OPTION.stop }
    : answerEverything(approval);

describe('stopping a Builder in-process', () => {
  it('refuses an edit the Builder asks for after the loop guard tripped', async () => {
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: TRIVIAL }), {
      cancelPollMs: SLOW_POLL_MS,
    });
    const looping = withTag(TRIVIAL, '#loopedit');
    const { conversationId, runId } = await startScenario(t, root, looping, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId, stopAtCard);
    expect(orchestration.crew[0]?.status).toBe('cancelled');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).not.toContain('after the loop');
  }, 60_000);

  it('keeps spend over the cost cap within one metered call', async () => {
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: COMPLEX }), {
      budget: { costCapUsd: COST_CAP },
      budgetPollMs: SLOW_POLL_MS,
      cancelPollMs: SLOW_POLL_MS,
    });
    const metered = withTag(COMPLEX, '#meter');
    const { conversationId, runId } = await startScenario(t, root, metered, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId, stopAtCard);
    expect(orchestration.budget.exceeded).toBe('cost');
    const builder = await builderCost(runId);
    expect(builder.status).toBe('cancelled');
    expect(builder.cost).toBeGreaterThanOrEqual(COST_CAP);
    expect(builder.cost).toBeLessThanOrEqual(COST_CAP + METER_CALL_USD + 1e-9);
  }, 60_000);
});
