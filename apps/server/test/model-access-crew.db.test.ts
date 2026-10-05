import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markModelRejected } from '../src/model-access/store.ts';
import {
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
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const OPUS = { id: 'opus[1m]', label: 'Opus 5.5' };
const REJECT_OPUS = { FAKE_ACP_REJECT_MODELS: JSON.stringify([OPUS.id]) };

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  script = { calls: [], scenario: TRIVIAL };
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function childRuns(runId: string) {
  const { rows } = await t.db.query<{
    model: string | null;
    used_model: string | null;
    switched: string | null;
    note: string | null;
  }>(
    `SELECT model, used_model, model_switch->'to'->>'id' AS switched, route->>'routeNote' AS note
     FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows;
}

describe('a failed Builder retried one tier up', { timeout: 90_000 }, () => {
  it('stays on a usable model when the tier above is known to be unusable', async () => {
    await markModelRejected(t.db, t.workspaceId, 'claude', OPUS);
    harness = startOrchestrator(t, jevFetch(script), { agentEnv: REJECT_OPUS });
    const flaky = withTag(TRIVIAL, '#failonce 1');
    const { conversationId, runId } = await startScenario(t, root, flaky, null);
    const { orchestration } = await driveToEnd(t, conversationId, runId);

    expect(orchestration.status).toBe('succeeded');
    const runs = await childRuns(runId);
    expect(runs.map((run) => run.model)).toEqual(['sonnet', 'sonnet']);
    expect(runs.map((run) => run.used_model)).toEqual(['sonnet', 'sonnet']);
    expect(runs.every((run) => run.switched === null)).toBe(true);
    expect(runs[0]?.note).toContain('Opus 5.5 not usable with this sign-in → Sonnet 5');
    const { rows } = await t.db.query<{ summary: string }>(
      `SELECT body->>'summary' AS summary FROM run_advice WHERE run_id = $1 AND purpose = 'route'`,
      [runId],
    );
    expect(rows[0]?.summary).toContain('Opus 5.5 not usable with this sign-in → Sonnet 5');
  });

  it('learns it during the retry and finishes the attempt on the nearest usable model', async () => {
    harness = startOrchestrator(t, jevFetch(script), { agentEnv: REJECT_OPUS });
    const flaky = withTag(TRIVIAL, '#failonce 1');
    const { conversationId, runId } = await startScenario(t, root, flaky, null);
    const { orchestration } = await driveToEnd(t, conversationId, runId);

    expect(orchestration.status).toBe('succeeded');
    const runs = await childRuns(runId);
    expect(runs.map((run) => run.model)).toEqual(['sonnet', 'opus[1m]']);
    expect(runs.map((run) => run.used_model)).toEqual(['sonnet', 'sonnet']);
    expect(runs[1]?.switched).toBe('sonnet');
  });
});
