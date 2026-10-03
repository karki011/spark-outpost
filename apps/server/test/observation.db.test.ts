import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POLICY_VERSION } from '../src/advisor/policy.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { DIFFS_OFF } from '../src/orchestration/observe.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

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

interface AdviceRow {
  purpose: string;
  jev_status: string;
  policy_version: string | null;
  body: {
    summary: string;
    jevModel: string | null;
    answer: Record<string, unknown> & { actual?: { verdict: string; approvalId: string | null } };
    state: Record<string, unknown> | null;
  };
}

async function observations(runId: string): Promise<AdviceRow[]> {
  const { rows } = await t.db.query<AdviceRow>(
    `SELECT purpose, jev_status, policy_version, body FROM run_advice
     WHERE run_id = $1 AND purpose IN ('policy', 'verify') ORDER BY created_at`,
    [runId],
  );
  return rows;
}

describe('observation mode', () => {
  it('records what the policy gate would do next to what the rules did, and never acts', async () => {
    const script: JevScript = { calls: [], scenario: NORMAL, policy: { destroys_work: 0.95 } };
    harness = startOrchestrator(t, jevFetch(script));
    const { conversationId, runId } = await startScenario(t, root, NORMAL, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');

    const rows = await observations(runId);
    const policy = rows.find((row) => row.purpose === 'policy')!;
    expect(policy).toMatchObject({ jev_status: 'answered', policy_version: POLICY_VERSION });
    expect(policy.body.answer).toMatchObject({
      observation: true,
      would: 'block',
      max: 0.95,
      path: expect.stringContaining('notes.txt'),
      actual: { verdict: 'allow' },
    });
    expect(policy.body.summary).toContain('Policy gate would block');
    expect(policy.body.state).toMatchObject({ diff: expect.stringContaining('+step 1') });
    expect(policy.body.jevModel).toBe('jev-test');

    const verify = rows.find((row) => row.purpose === 'verify')!;
    expect(verify.body.answer).toMatchObject({
      observation: false,
      would: 'supported',
      action: 'finish',
    });
    expect(verify.body.state).toMatchObject({ diff: expect.stringContaining('step 1') });

    const view = await loadOrchestration(t.db, runId);
    expect(view?.decisions.map((decision) => decision.kind)).toEqual(
      expect.arrayContaining(['intake', 'route', 'policy', 'verify']),
    );
  }, 60_000);

  it('links the observation to the approval the user answered', async () => {
    const script: JevScript = { calls: [], scenario: NORMAL };
    harness = startOrchestrator(t, jevFetch(script));
    const { conversationId, runId } = await startScenario(t, root, NORMAL, null);
    await driveToEnd(t, conversationId, runId);
    const policy = (await observations(runId)).find((row) => row.purpose === 'policy')!;
    expect(policy.body.answer.actual?.verdict).toBe('ask');
    const { rows } = await t.db.query<{ status: string }>(
      'SELECT status FROM approvals WHERE id = $1',
      [policy.body.answer.actual!.approvalId],
    );
    expect(rows).toEqual([{ status: 'allowed' }]);
  }, 60_000);

  it('sends no diff and records "skipped" when code diffs are turned off', async () => {
    await updateProfile(t.db, t.workspaceId, { jevDiffs: false });
    const script: JevScript = { calls: [], scenario: NORMAL };
    harness = startOrchestrator(t, jevFetch(script));
    const { conversationId, runId } = await startScenario(t, root, NORMAL, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    const rows = await observations(runId);
    expect(rows.map((row) => [row.purpose, row.jev_status, row.body.summary])).toEqual([
      ['policy', 'not_asked', DIFFS_OFF],
      ['verify', 'not_asked', DIFFS_OFF],
    ]);
    expect(script.calls.every((call) => call.state.diff === undefined)).toBe(true);
  }, 60_000);
});
