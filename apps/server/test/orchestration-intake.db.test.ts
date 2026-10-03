import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, clarifyOptionId } from '@spark-outpost/contracts';
import { conversationPlans, planDocuments } from '../src/persistence/plan-documents.ts';
import { BUG_FINDINGS } from './fake-acp-roles.ts';
import { FAKE_PLAN, PLAN_REPLY_TRIGGER } from './fake-acp-plans.ts';
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

const REVIEW_S07: Scenario = {
  id: 'review',
  text: "Review my uncommitted changes before I commit them. Don't change anything; just tell me what's wrong. #bugreview",
  mode: 'do',
  question: 0.93,
  review: 0.9,
  destructive: 0.02,
  intent: 'review',
};

const PLAN_S03: Scenario = {
  id: 'plan',
  text: `Plan adding CSV export to Analytics. Plan only for now: don't change any files. ${PLAN_REPLY_TRIGGER}`,
  mode: 'do',
  question: 0.69,
  planOnly: 0.9,
  destructive: 0.02,
  intent: 'feature',
};

const FASTER_S08: Scenario = {
  id: 'faster',
  text: 'Make it faster. #build',
  mode: 'do',
  question: 0.02,
  vague: 0.96,
  destructive: 0.02,
  intent: 'refactor',
  intentProbabilities: { refactor: 0.6, feature: 0.3, bug_fix: 0.1 },
  speed: { page_load: 0.6, tests: 0.25, startup: 0.1, build: 0.05 },
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

async function run(scenario: Scenario, answer: Answerer = answerEverything) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }));
  const { conversationId, runId } = await startScenario(t, root, scenario, null);
  const done = await driveToEnd(t, conversationId, runId, answer);
  const replies = await t.db.query<{ id: string; content: string }>(
    `SELECT id, content FROM messages WHERE run_id = $1 AND role = 'assistant' ORDER BY created_at`,
    [runId],
  );
  const children = await t.db.query<{ role: string; prompt: string }>(
    'SELECT role, prompt FROM runs WHERE parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  const parent = await t.db.query<{ role: string | null }>('SELECT role FROM runs WHERE id = $1', [
    runId,
  ]);
  return {
    ...done,
    conversationId,
    runId,
    replies: replies.rows,
    children: children.rows,
    inPlace: parent.rows[0]?.role ?? null,
  };
}

function git(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

describe('a review of uncommitted changes (dev-day s07)', () => {
  it('goes to the Critic with the diff since HEAD, including new files, and answers with its findings', async () => {
    await writeFile(join(root, 'plural.ts'), 'export const plural = (n: number) => n === 1;\n');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plural');
    await writeFile(join(root, 'plural.ts'), 'export const plural = (n: number) => n <= 1;\n');
    await writeFile(
      join(root, 'median.ts'),
      'export const median = (xs: number[]) => xs.sort();\n',
    );

    const { orchestration, asked, children, replies, inPlace } = await run(REVIEW_S07);

    expect(orchestration.status).toBe('succeeded');
    expect(inPlace).toBeNull();
    expect(children.map((child) => child.role)).toEqual(['critic']);
    const prompt = children[0]!.prompt;
    expect(prompt).toContain('Role: Critic.');
    expect(prompt).toContain('- plural.ts (+1 -1, changed before this task)');
    expect(prompt).toContain('- median.ts (+1 -0, changed before this task)');
    expect(prompt).toContain('+export const plural = (n: number) => n <= 1;');
    expect(prompt).toContain('+export const median');
    expect(asked).toEqual([]);
    const reply = replies.map((row) => row.content).join('\n');
    expect(reply).toContain(BUG_FINDINGS[0]);
    expect(reply).toMatch(/AI review by .+: concerns\./);
    expect(await readFile(join(root, 'plural.ts'), 'utf8')).toContain('n <= 1');
    expect(git('status', '--porcelain')).toContain('?? median.ts');
  }, 60_000);
});

describe('a plan-only request (dev-day s03)', () => {
  it('writes a plan without an answer-or-build card, saves it as proposed, and approves it from the plan card', async () => {
    const { orchestration, asked, children, replies, conversationId, runId } = await run(PLAN_S03);

    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.kind)).toEqual(['plan']);
    expect(asked[0]!.title).toBe('Approve the plan?');
    expect(asked[0]!.options.map((option) => option.optionId)).toEqual([
      CHECKPOINT_OPTION.approvePlan,
      CHECKPOINT_OPTION.editPlan,
      CHECKPOINT_OPTION.stop,
    ]);
    expect(children).toEqual([]);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.content).toContain(FAKE_PLAN.split('\n')[0]!);

    const plans = await planDocuments(t.db, conversationId);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      status: 'approved',
      approvedBy: 'user',
      approvedOption: CHECKPOINT_OPTION.approvePlan,
      sourceRunId: runId,
      sourceMessageId: replies[0]!.id,
    });
    expect((await conversationPlans(t.db, conversationId)).saved).toEqual([
      { messageId: replies[0]!.id, version: 1 },
    ]);
    expect(git('status', '--porcelain')).toBe('');
  }, 60_000);

  it('revises the plan with the user’s note and keeps only the approved version', async () => {
    let cards = 0;
    const revise: Answerer = (approval) => {
      if (approval.kind !== 'plan') return answerEverything(approval);
      cards += 1;
      return cards === 1
        ? { optionId: CHECKPOINT_OPTION.editPlan, note: 'Also cover an empty table' }
        : { optionId: CHECKPOINT_OPTION.approvePlan };
    };
    const { orchestration, asked, replies, conversationId } = await run(PLAN_S03, revise);

    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.kind)).toEqual(['plan', 'plan']);
    expect(replies).toHaveLength(2);
    const plans = await planDocuments(t.db, conversationId);
    expect(plans.map((plan) => [plan.version, plan.status])).toEqual([
      [1, 'rejected'],
      [2, 'approved'],
    ]);
  }, 60_000);
});

describe('a vague "make it faster" (dev-day s08)', () => {
  it('asks about kinds of speed, ordered by Jev, with a free-text answer', async () => {
    const stop: Answerer = (approval) =>
      approval.kind === 'clarify' ? { optionId: CHECKPOINT_OPTION.stop } : null;
    const { asked, children } = await run(FASTER_S08, stop);

    expect(asked.map((approval) => approval.kind)).toEqual(['clarify']);
    expect(asked[0]!.options.map((option) => option.name)).toEqual([
      'Page load: make pages load and render faster',
      'Tests: make the test suite run faster',
      'Startup: make the app and dev server start faster',
      'Answer in your own words',
      'Go with the most likely',
      'Stop',
    ]);
    expect(asked[0]!.options.map((option) => option.optionId)[0]).toBe(clarifyOptionId(0));
    expect(children).toEqual([]);
  }, 60_000);
});
