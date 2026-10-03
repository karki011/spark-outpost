import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckpointPayload, InvolvementLevel } from '@spark-outpost/contracts';
import {
  TRIVIAL,
  answerEverything,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const REVIEWED: Scenario = { ...TRIVIAL, review: 0.95 };

interface KeepRow {
  status: string;
  decided_by: string;
  reason: string;
  payload: { checkpoint: CheckpointPayload };
}

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t, false);
  harness = startOrchestrator(t, null, { sessions: store });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function runAt(tag: string, level: InvolvementLevel) {
  const { conversationId, runId } = await startScenario(
    t,
    root,
    withTag(REVIEWED, `Have it reviewed. ${tag}`),
    level,
  );
  const result = await driveToEnd(t, conversationId, runId, answerEverything, 110_000);
  const accepts = (
    await t.db.query<KeepRow>(
      `SELECT status, decided_by, reason, payload FROM approvals
       WHERE run_id = $1 AND kind = 'accept' ORDER BY created_at`,
      [runId],
    )
  ).rows;
  const text = (await assistantReplies(t, runId)).join('\n');
  const { rows } = await t.db.query<{ role: string; status: string }>(
    `SELECT role, status FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return { ...result, accepts, text, children: rows };
}

describe('the end of a run at Automatic', () => {
  it('keeps without a blocking card when the Critic still has concerns, and says so', async () => {
    const { asked, orchestration, accepts, text } = await runAt('#stuckreview', 'hands-off');
    expect(orchestration.status).toBe('succeeded');
    expect(asked.filter((approval) => approval.kind === 'accept')).toEqual([]);
    expect(accepts).toHaveLength(1);
    expect(accepts[0]).toMatchObject({ status: 'allowed', decided_by: 'level' });
    expect(accepts[0]!.payload.checkpoint).toMatchObject({ keptBy: 'hands-off' });
    expect(accepts[0]!.reason).toContain(
      'Kept automatically; worth a look: the Critic still has concerns.',
    );
    expect(accepts[0]!.payload.checkpoint.lines).toEqual({
      added: expect.any(Number),
      removed: expect.any(Number),
    });
    expect(text).toContain('Still concerns after 1 round');
  }, 120_000);

  it('retries a failing Critic once, then skips the review with a quiet note and keeps', async () => {
    const { asked, orchestration, accepts, text, children } = await runAt(
      '#criticdown',
      'hands-off',
    );
    expect(orchestration.status).toBe('succeeded');
    expect(children).toEqual([
      { role: 'builder', status: 'succeeded' },
      { role: 'critic', status: 'failed' },
      { role: 'critic', status: 'failed' },
    ]);
    expect(asked).toEqual([]);
    expect(accepts).toHaveLength(1);
    expect(accepts[0]).toMatchObject({ status: 'allowed', decided_by: 'level' });
    expect(accepts[0]!.reason).toContain('the Critic was unavailable, so no AI review ran');
    expect(text).toMatch(/Review skipped \(Critic unavailable: .*error.*\)\./);
  }, 120_000);
});
