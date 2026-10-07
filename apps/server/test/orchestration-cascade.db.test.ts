import { needsYouLine } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POLICY_VERSION } from '../src/advisor/policy.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DECLINED_REASON,
  ESCALATED_NOTE,
  UNCONFIRMED_REASON,
} from '../src/orchestration/cascade.ts';
import {
  NORMAL,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  setCheckCommands,
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

interface VerifyRow {
  jev_status: string;
  policy_version: string;
  body: { summary: string; applied: string; answer: Record<string, unknown> };
}

async function verdicts(runId: string): Promise<VerifyRow[]> {
  const { rows } = await t.db.query<VerifyRow>(
    `SELECT jev_status, policy_version, body FROM run_advice
     WHERE run_id = $1 AND purpose = 'verify' ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function builders(runId: string) {
  const { rows } = await t.db.query<{ model: string; route: { followUp?: string } }>(
    `SELECT model, route FROM runs WHERE parent_run_id = $1 AND role = 'builder' ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function reply(runId: string): Promise<string> {
  return (await assistantReplies(t, runId)).join('\n');
}

async function runWith(script: Omit<JevScript, 'calls'>, level = 'full-auto' as const) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL, ...script }));
  const { conversationId, runId } = await startScenario(t, root, NORMAL, level);
  return { conversationId, runId };
}

describe('verified cascade', () => {
  it('reruns the Builder once, one tier up, when Jev says the change is unsupported', async () => {
    const { conversationId, runId } = await runWith({
      verify: 0.92,
      verdicts: [
        { choice: 'unsupported', confidence: 0.93 },
        { choice: 'unsupported', confidence: 0.9 },
      ],
    });
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');

    const runs = await builders(runId);
    expect(runs.map((run) => run.model)).toEqual(['sonnet', 'opus[1m]']);
    expect(runs[1]!.route.followUp).toContain('An independent check of your change');
    expect(runs[1]!.route.followUp).toContain('The divider shows the wrong day after midnight.');

    const rows = await verdicts(runId);
    expect(rows.map((row) => row.body.answer.action)).toEqual(['escalate', 'finish']);
    expect(rows[0]).toMatchObject({
      jev_status: 'answered',
      policy_version: POLICY_VERSION,
      body: {
        applied: 'jev',
        answer: {
          round: 1,
          verdict: 'unsupported',
          accepted: 'unsupported',
          would: 'unsupported',
          escalateTo: { model: 'opus[1m]' },
        },
      },
    });
    expect(rows[0]!.body.summary).toContain('rerun one tier up with Opus 5.5');
    expect(rows[1]!.body.answer).toMatchObject({ round: 2, accepted: 'unsupported' });
    expect(await reply(runId)).toContain(ESCALATED_NOTE);
  }, 60_000);

  it("does not rerun when Jev names nothing missing for sure and Spark's checks pass (H)", async () => {
    await writeFile(join(root, 'check.mjs'), "console.log('ok');\n");
    await setCheckCommands(t, root, ['node check.mjs']);
    const { conversationId, runId } = await runWith(
      { verify: 0.72, verdicts: [{ choice: 'unsupported', confidence: 0.82 }] },
      'full-auto',
    );
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await builders(runId)).toHaveLength(1);
    expect(asked).toEqual([]);
    expect(orchestration.checkpoints.map((checkpoint) => checkpoint.kind)).toEqual(['accept']);
    expect(await reply(runId)).toContain(needsYouLine(UNCONFIRMED_REASON));
    expect((await verdicts(runId))[0]!.body.answer).toMatchObject({
      action: 'ask',
      evidence: { checksPass: true, criticConcerns: false, confidentUnmet: false },
    });
    expect(await reply(runId)).not.toContain(ESCALATED_NOTE);
  }, 60_000);

  it('says what needs you when Jev declines, with no card, and keeps the change', async () => {
    const { conversationId, runId } = await runWith(
      { verdicts: [{ choice: 'declined', confidence: 0.9 }] },
      'full-auto',
    );
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(asked).toEqual([]);
    expect(
      orchestration.checkpoints.map((checkpoint) => [
        checkpoint.kind,
        checkpoint.payload.checkpoint?.keptBy,
      ]),
    ).toEqual([['accept', 'full-auto']]);
    expect(await reply(runId)).toContain(needsYouLine(DECLINED_REASON));
    expect(await builders(runId)).toHaveLength(1);
    expect((await verdicts(runId))[0]!.body.answer).toMatchObject({ action: 'ask' });
  }, 60_000);

  it('finishes as today when the verdict is below 0.8', async () => {
    const { conversationId, runId } = await runWith({
      verdicts: [{ choice: 'unsupported', confidence: 0.6 }],
    });
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await builders(runId)).toHaveLength(1);
    const [row] = await verdicts(runId);
    expect(row!.body).toMatchObject({
      applied: 'rules',
      answer: { verdict: 'unsupported', accepted: null, would: 'unverified', action: 'finish' },
    });
    expect(await reply(runId)).not.toContain(ESCALATED_NOTE);
  }, 60_000);

  it('runs checks only without Jev: no verdict and no escalation', async () => {
    harness = startOrchestrator(t, null);
    const { conversationId, runId } = await startScenario(t, root, NORMAL, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await builders(runId)).toHaveLength(1);
    expect(await verdicts(runId)).toEqual([]);
  }, 60_000);
});
