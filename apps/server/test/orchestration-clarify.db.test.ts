import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clarifyOptionId } from '@spark-outpost/contracts';
import { updateProfile } from '../src/persistence/setup.ts';
import {
  answerEverything,
  assistantReplies,
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

const FASTER: Scenario = {
  id: 'faster',
  text: 'Make it faster. #build',
  mode: 'do',
  question: 0.02,
  destructive: 0.02,
  vague: 0.94,
  intent: 'refactor',
  intentProbabilities: { refactor: 0.7, feature: 0.2, bug_fix: 0.1 },
};

async function run(
  level: 'balanced' | 'hands-off' | 'full-auto',
  answer: Answerer = answerEverything,
  scenario: Scenario = VAGUE,
) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }));
  const { conversationId, runId } = await startScenario(t, root, scenario, level);
  const done = await driveToEnd(t, conversationId, runId, answer);
  const reply = (await assistantReplies(t, runId)).at(-1);
  return { ...done, reply: reply ?? '', runId };
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

  it('asks at Auto-edit too, before any Builder runs', async () => {
    const stop: Answerer = (approval) =>
      approval.kind === 'clarify' ? { optionId: 'stop' } : answerEverything(approval);
    const { asked, orchestration, reply, runId } = await run('hands-off', stop);
    expect(orchestration.status).toBe('cancelled');
    expect(asked.map((approval) => approval.kind)).toEqual(['clarify']);
    expect(asked[0]!.title).toBe('What should change?');
    expect(reply).not.toContain('Assumed you meant');
    const { rows } = await t.db.query(`SELECT 1 FROM runs WHERE parent_run_id = $1`, [runId]);
    expect(rows).toHaveLength(0);
  }, 60_000);

  it('asks at Auto-edit for "Make it faster." (Jev vague 0.94), with speed readings', async () => {
    const pick: Answerer = (approval) =>
      approval.kind === 'clarify' ? { optionId: clarifyOptionId(0) } : answerEverything(approval);
    const { asked, orchestration, reply, runId } = await run('hands-off', pick, FASTER);
    expect(orchestration.status).toBe('succeeded');
    const clarify = asked.find((approval) => approval.kind === 'clarify')!;
    expect(clarify.title).toBe('What should change?');
    expect(clarify.options[0]!.name).toMatch(/^(Startup|Page load|Tests|Build|API and database):/);
    expect(reply).toContain('Clarified:');
    expect(reply).not.toContain('Assumed you meant');
    const intake = await t.db.query<{ vague: unknown }>(
      `SELECT body->'calls'->'vague' AS vague FROM run_advice WHERE run_id = $1 AND purpose = 'intake'`,
      [runId],
    );
    expect(intake.rows[0]?.vague).toMatchObject({
      jev: 0.94,
      value: true,
      gate: { level: 'hands-off', decision: 'act' },
    });
  }, 60_000);

  it('assumes only at Full auto, and says what it assumed', async () => {
    const { asked, orchestration, reply } = await run('full-auto');
    expect(orchestration.status).toBe('succeeded');
    expect(asked.some((approval) => approval.kind === 'clarify')).toBe(false);
    expect(reply).toContain('Took it as: Improve its documentation');
    expect(reply).toContain('Assumed you meant: Improve its documentation.');
  }, 60_000);
});
