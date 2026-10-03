import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUG_FINDINGS } from './fake-acp-roles.ts';
import {
  TRIVIAL,
  assistantReplies,
  answerEverything,
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

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

interface FindingAnswer {
  review: number;
  action: string;
  fixable: number;
}

async function runTagged(tag: string) {
  await connectProviders(t, false);
  harness = startOrchestrator(t, null, { sessions: store });
  const { conversationId, runId } = await startScenario(
    t,
    root,
    withTag(REVIEWED, tag),
    'hands-off',
  );
  const { orchestration } = await driveToEnd(t, conversationId, runId, answerEverything, 110_000);
  const { rows: roles } = await t.db.query<{ role: string }>(
    'SELECT role FROM runs WHERE parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  const { rows: advice } = await t.db.query<{ body: { answer: FindingAnswer } }>(
    `SELECT body FROM run_advice WHERE run_id = $1 AND purpose = 'finding' ORDER BY created_at`,
    [runId],
  );
  return {
    orchestration,
    roles: roles.map((row) => row.role),
    answers: advice.map((row) => row.body.answer),
    reply: (await assistantReplies(t, runId)).join('\n'),
  };
}

describe('Critic findings marked fixed', () => {
  it('treats "Fixed:" items as resolved and stops after one retry when the rest come back', async () => {
    const { orchestration, roles, answers, reply } = await runTagged(
      'Have it reviewed. #fixedecho',
    );
    expect(orchestration.status).toBe('succeeded');
    expect(roles).toEqual(['builder', 'critic', 'builder', 'critic']);
    expect(answers).toMatchObject([
      { review: 1, action: 'fix', fixable: 2 },
      { review: 2, action: 'repeated', fixable: 1 },
    ]);
    expect(reply).toContain(
      'Still concerns after 1 round: the same findings came back after the fix',
    );
    expect(reply).toContain(BUG_FINDINGS[1]);
    expect(reply).not.toContain(`Fixed: ${BUG_FINDINGS[0]}`);
  }, 120_000);

  it('counts a recheck whose findings are all marked fixed as clean', async () => {
    const { orchestration, roles, answers, reply } = await runTagged('Have it reviewed. #fixedall');
    expect(orchestration.status).toBe('succeeded');
    expect(roles).toEqual(['builder', 'critic', 'builder', 'critic']);
    expect(answers.map((answer) => [answer.review, answer.action])).toEqual([[1, 'fix']]);
    expect(reply).toContain(
      "Fixed after 1 review round: the Critic's last review found no correctness problems",
    );
  }, 120_000);
});
