import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { DESTRUCTIVE_WAIT } from '../src/orchestration/checkpoint-policy.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import {
  NORMAL,
  answerEverything,
  connectProviders,
  driveToEnd,
  jevFetch,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import {
  FAKE_GH,
  repoWithRemote,
  startGitHubStub,
  type GitHubStub,
  type TestRepo,
} from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let harness: Harness | null = null;
let repo: TestRepo;
let repoCount = 0;

const ghState = () => path.join(base, 'gh-state');

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-clarify-turn-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = ghState();
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await writeFile(ghState(), 'octo-cli');
  await connectProviders(t);
  repoCount += 1;
  repo = await repoWithRemote(base, `reports-${repoCount}`, 'github');
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await stub.close();
  await t.cleanup();
});

const VAGUE: Scenario = {
  ...NORMAL,
  id: 'vague',
  text: 'Make the reports better #build #questions',
  vague: 0.95,
  intent: 'feature',
};

async function run(
  scenario: Scenario,
  level: InvolvementLevel | null,
  answer: Answerer = answerEverything,
) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }), {
    shipAccess: {
      secrets: memorySecretStore(),
      runCommand,
      fetch,
      apiUrl: stub.url,
      locateGh: async () => FAKE_GH,
    },
  });
  const { conversationId, runId } = await startScenario(t, repo.root, scenario, level);
  const done = await driveToEnd(t, conversationId, runId, answer, 90_000);
  const builders = await t.db.query<{ prompt: string }>(
    `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'builder' ORDER BY created_at`,
    [runId],
  );
  const clarify = await t.db.query<{ body: Record<string, unknown> }>(
    `SELECT body FROM run_advice WHERE run_id = $1 AND purpose = 'clarify' ORDER BY created_at`,
    [runId],
  );
  const root = await t.db.query<{ mode: string }>('SELECT mode FROM runs WHERE id = $1', [runId]);
  return {
    ...done,
    runId,
    mode: root.rows[0]?.mode,
    builderPrompts: builders.rows.map((row) => row.prompt),
    clarify: clarify.rows.map((row) => row.body),
  };
}

const CLEANUP: Scenario = {
  ...VAGUE,
  id: 'cleanup',
  text: 'Clean up the reports table — drop the old rows #build #questions',
  destructive: 0.95,
};

const QUESTIONS_TITLE = 'A few questions first';
const PLAN_TITLE = 'Build this plan?';

const answerHeldCards: Answerer = (approval) => {
  if (approval.title === QUESTIONS_TITLE) return { optionId: clarifyOptionId(1) };
  if (approval.title === PLAN_TITLE) return { optionId: CHECKPOINT_OPTION.makeChange };
  return answerEverything(approval);
};

const kinds = (asked: readonly { kind: string; title: string }[]) =>
  asked.map((approval) => `${approval.kind}: ${approval.title}`);

describe('a vague request asks the agent to clarify first', () => {
  it('asks its questions, waits for the answer, and builds the clarified request', async () => {
    const pick: Answerer = (approval) =>
      approval.title === 'A few questions first'
        ? { optionId: clarifyOptionId(1) }
        : answerEverything(approval);
    const done = await run(VAGUE, null, pick);
    expect(done.orchestration.status).toBe('succeeded');
    expect(done.mode).toBe('do');
    const clarify = done.asked.find((approval) => approval.title === 'A few questions first')!;
    expect(clarify.payload.checkpoint).toMatchObject({
      choices: ['Spend', 'Usage'],
      questions: [{ question: 'Which report?', options: ['Spend', 'Usage'], default: 'Spend' }],
    });
    expect(done.builderPrompts[0]).toContain('The user answered: Usage');
    expect(done.clarify).toEqual([
      expect.objectContaining({ round: 1, answered: true, reply: 'choice', defaultsUsed: false }),
    ]);
    expect(await readFile(path.join(repo.root, 'notes.txt'), 'utf8')).toContain('step 1');
  }, 120_000);

  it('asks a second round only when the answer is itself vague, and never a third', async () => {
    const vagueAnswer: Answerer = (approval) =>
      approval.title === 'A few questions first'
        ? { optionId: CHECKPOINT_OPTION.answer, note: 'fix the thing' }
        : answerEverything(approval);
    const done = await run(VAGUE, 'hands-off', vagueAnswer);
    expect(
      done.asked.filter((approval) => approval.title === 'A few questions first'),
    ).toHaveLength(2);
    expect(done.clarify.map((body) => body.round)).toEqual([1, 2]);
    expect(done.orchestration.status).toBe('succeeded');
    expect(done.builderPrompts).toHaveLength(1);
  }, 120_000);

  it('goes with the best guesses after the answer wait at Automatic, and the card says so', async () => {
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    const done = await run(VAGUE, 'hands-off', (approval) =>
      approval.title === 'A few questions first' ? null : answerEverything(approval),
    );
    expect(done.orchestration.status).toBe('succeeded');
    const clarify = done.orchestration.checkpoints.find(
      (approval) => approval.title === 'A few questions first',
    )!;
    expect(clarify).toMatchObject({
      status: 'allowed',
      decidedBy: 'auto',
      decisionOptionId: CHECKPOINT_OPTION.useDefaults,
    });
    expect(clarify.autoContinueAt).not.toBeNull();
    expect(done.clarify[0]).toMatchObject({ reply: 'defaults', defaultsUsed: true });
    expect(done.builderPrompts[0]).toContain('No answer, so go with the defaults.');
  }, 120_000);

  it('waits for an answer when the answer wait is off, outside Full auto', async () => {
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: null });
    const done = await run(VAGUE, 'hands-off', (approval) =>
      approval.title === 'A few questions first'
        ? { optionId: CHECKPOINT_OPTION.useDefaults }
        : answerEverything(approval),
    );
    const clarify = done.orchestration.checkpoints.find(
      (approval) => approval.title === 'A few questions first',
    )!;
    expect(clarify).toMatchObject({ decidedBy: 'user', autoContinueAt: null });
  }, 120_000);

  it('never asks about a clear request, even at Full auto', async () => {
    const done = await run({ ...NORMAL, vague: 0.03 }, 'full-auto');
    expect(done.orchestration.status).toBe('succeeded');
    expect(kinds(done.asked)).toEqual([]);
    expect(done.clarify).toEqual([]);
  }, 120_000);
});

describe('Full auto: best guesses, plan first, then build and ship', () => {
  it('goes with the defaults, waits on the plan for Build, and lists both in the PR', async () => {
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    const done = await run(VAGUE, 'full-auto', (approval) =>
      approval.title === 'Build this plan?' ? { optionId: CHECKPOINT_OPTION.makeChange } : null,
    );
    expect(done.orchestration.status).toBe('succeeded');
    const cards = done.orchestration.checkpoints.map((approval) => [
      approval.title,
      approval.decidedBy,
    ]);
    expect(cards).toEqual(
      expect.arrayContaining([
        ['A few questions first', 'auto'],
        ['Build this plan?', 'user'],
      ]),
    );
    const plan = done.orchestration.checkpoints.find(
      (approval) => approval.title === 'Build this plan?',
    )!;
    expect(plan.autoContinueAt ?? null).toBeNull();
    expect(done.clarify[0]).toMatchObject({ reply: 'defaults', defaultsUsed: true });
    expect(done.builderPrompts[0]).toContain('No answer, so go with the defaults.');
    expect(stub.github.pulls).toHaveLength(1);
    const body = stub.github.pulls[0]!.body;
    expect(body).toContain('Clarifying questions (no answer, went with the defaults)');
    expect(body).toContain('Which report? → Spend');
    expect(body).toContain('Plan it followed:');
  }, 120_000);

  it('ends without changes when the plan card is stopped', async () => {
    const stop: Answerer = (approval) => {
      if (approval.title === 'Build this plan?') return { optionId: CHECKPOINT_OPTION.stop };
      if (approval.title === 'A few questions first') {
        return { optionId: CHECKPOINT_OPTION.useDefaults };
      }
      return answerEverything(approval);
    };
    const done = await run(VAGUE, 'full-auto', stop);
    expect(done.orchestration.status).toBe('cancelled');
    expect(done.builderPrompts).toEqual([]);
    expect(stub.github.pulls).toEqual([]);
    expect(await readFile(path.join(repo.root, 'notes.txt'), 'utf8').catch(() => '')).not.toContain(
      'step 1',
    );
  }, 120_000);
});

describe('destructive work never runs on a countdown', () => {
  it.each(['hands-off', 'full-auto'] as const)(
    'holds the questions and the plan for your answer at %s, then builds',
    async (level) => {
      await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
      const done = await run(CLEANUP, level, answerHeldCards);
      expect(done.orchestration.status).toBe('succeeded');
      const cards = done.orchestration.checkpoints.filter((approval) =>
        [QUESTIONS_TITLE, PLAN_TITLE].includes(approval.title),
      );
      expect(cards.map((approval) => [approval.title, approval.decidedBy])).toEqual([
        [QUESTIONS_TITLE, 'user'],
        [PLAN_TITLE, 'user'],
      ]);
      for (const card of cards) {
        expect(card.autoContinueAt).toBeNull();
        expect(card.payload.checkpoint).toMatchObject({
          autoOption: null,
          waitsFor: DESTRUCTIVE_WAIT,
        });
      }
      expect(done.builderPrompts[0]).toContain('The user answered: Usage');
    },
    120_000,
  );

  it('holds the questions when their best guesses would delete data, then plans first', async () => {
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    const scenario = { ...VAGUE, text: 'Make the reports better #build #questions #oldrows' };
    const done = await run(scenario, 'hands-off', (approval) => {
      if (approval.title === QUESTIONS_TITLE) return { optionId: CHECKPOINT_OPTION.useDefaults };
      return answerHeldCards(approval);
    });
    expect(done.orchestration.status).toBe('succeeded');
    const [questions, plan] = done.orchestration.checkpoints;
    expect(questions).toMatchObject({ title: QUESTIONS_TITLE, decidedBy: 'user' });
    expect(questions!.payload.checkpoint).toMatchObject({ waitsFor: DESTRUCTIVE_WAIT });
    expect(plan).toMatchObject({ title: PLAN_TITLE, decidedBy: 'user', autoContinueAt: null });
    expect(done.builderPrompts).toHaveLength(1);
  }, 120_000);

  it('stops before any Builder when the destructive plan is stopped', async () => {
    const done = await run(CLEANUP, 'full-auto', (approval) =>
      approval.title === PLAN_TITLE
        ? { optionId: CHECKPOINT_OPTION.stop }
        : answerHeldCards(approval),
    );
    expect(done.orchestration.status).toBe('cancelled');
    expect(done.builderPrompts).toEqual([]);
  }, 120_000);
});
