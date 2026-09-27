import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clarifyOptionId } from '@spark-outpost/contracts';
import { updateProfile } from '../src/persistence/setup.ts';
import {
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const VAGUE: Scenario = {
  id: 'vague',
  text: 'Make the reports better. #build',
  mode: 'do',
  question: 0.02,
  destructive: 0.02,
  intent: 'docs',
  intentProbabilities: { docs: 0.6, feature: 0.3, refactor: 0.1 },
};

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

async function run(level: 'balanced' | 'hands-off', answer: Answerer = answerEverything) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: VAGUE }));
  const { conversationId, runId } = await startScenario(t, root, VAGUE, level);
  const done = await driveToEnd(t, conversationId, runId, answer);
  const { rows } = await t.db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'`,
    [runId],
  );
  return { ...done, reply: rows[0]?.content ?? '', runId };
}

describe('a vague request', () => {
  it('asks one short question at Balanced and builds what the user picked', async () => {
    const pick: Answerer = (approval) =>
      approval.kind === 'clarify' ? { optionId: clarifyOptionId(1) } : answerEverything(approval);
    const { asked, orchestration, reply } = await run('balanced', pick);
    expect(orchestration.status).toBe('succeeded');
    const clarify = asked.find((approval) => approval.kind === 'clarify')!;
    expect(clarify.title).toBe('What should change?');
    expect(clarify.options.map((option) => option.name)).toEqual([
      'Improve its documentation',
      'Add new behaviour or features',
      'Restructure the code without changing what it does',
      'Answer in your own words',
      'Go with the most likely',
      'Stop',
    ]);
    expect(reply).toContain('Clarified: Add new behaviour or features');
    expect(reply).not.toContain('Assumed you meant');
  }, 60_000);

  it('goes with the most likely reading when the question is left for the auto-continue', async () => {
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    const skip: Answerer = (approval) =>
      approval.kind === 'clarify' ? null : answerEverything(approval);
    const { orchestration, reply } = await run('balanced', skip);
    expect(orchestration.checkpoints[0]).toMatchObject({ kind: 'clarify', decidedBy: 'auto' });
    expect(reply).toContain('Took it as: Improve its documentation');
    expect(reply).toContain('Assumed you meant: Improve its documentation.');
  }, 60_000);

  it('does not ask at Hands-off, and says what it assumed', async () => {
    const { asked, orchestration, reply } = await run('hands-off');
    expect(orchestration.status).toBe('succeeded');
    expect(asked.some((approval) => approval.kind === 'clarify')).toBe(false);
    expect(reply).toContain('Took it as: Improve its documentation');
    expect(reply).toContain('Assumed you meant: Improve its documentation.');
  }, 60_000);
});
