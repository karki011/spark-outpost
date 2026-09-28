import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type CheckBody, type InvolvementLevel } from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../src/advisor/policy.ts';
import { createProject } from '../src/projects/projects.ts';
import { BUG_FINDINGS, ROUND_FINDINGS } from './fake-acp-roles.ts';
import {
  SCENARIOS,
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
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const REVIEWED: Scenario = { ...(SCENARIOS[1] as Scenario), review: 0.95 };
const JEV_SAYS_BUGS = { finding_1: 0.95, finding_2: 0.9 };
const NO_BUDGET_POLL = 600_000;

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  script = { calls: [] };
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

interface StartOptions {
  jev?: boolean;
  policy?: JevScript['policy'];
  costCapUsd?: number;
}

async function start(options: StartOptions = {}) {
  const jev = options.jev ?? true;
  await connectProviders(t, jev);
  script.scenario = REVIEWED;
  if (options.policy) script.policy = options.policy;
  harness = startOrchestrator(t, jev ? jevFetch(script) : null, {
    sessions: store,
    ...(options.costCapUsd === undefined
      ? {}
      : { budget: { costCapUsd: options.costCapUsd }, budgetPollMs: NO_BUDGET_POLL }),
  });
}

function begin(tag: string, level: InvolvementLevel) {
  return startScenario(t, root, { ...REVIEWED, text: `${REVIEWED.text} ${tag}` }, level);
}

async function configureCheck(source: string): Promise<void> {
  await writeFile(join(root, 'check.mjs'), source);
  const { project } = await createProject(t.db, t.workspaceId, root);
  await t.db.query('UPDATE projects SET check_commands = $2 WHERE id = $1', [
    project.id,
    ['node check.mjs'],
  ]);
}

const PASSING_CHECK = "console.log('ok');\n";
const FAILS_AFTER_REVIEW_FIX = `import { readFileSync } from 'node:fs';
if (readFileSync('notes.txt', 'utf8').includes('fixed the review findings')) {
  console.error('the review fix broke the notes');
  process.exit(1);
}
console.log('ok');
`;

interface ChildRow {
  role: string;
  route: Record<string, string | undefined>;
  task_id: string;
}

async function children(runId: string): Promise<ChildRow[]> {
  const { rows } = await t.db.query<ChildRow>(
    `SELECT role, route, task_id FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows;
}

const roles = async (runId: string) => (await children(runId)).map((row) => row.role);

async function checkStatuses(): Promise<string[]> {
  const { rows } = await t.db.query<{ body: CheckBody }>(
    `SELECT body FROM run_artifacts WHERE kind = 'check' ORDER BY version`,
  );
  return rows.map((row) => row.body.status);
}

interface AdviceRow {
  jev_status: string;
  role: string;
  policy_version: string;
  body: {
    summary: string;
    applied: string;
    answer: { review: number; fixRound: number; fixable: number; action: string };
  };
}

async function findingAdvice(runId: string): Promise<AdviceRow[]> {
  const { rows } = await t.db.query<AdviceRow>(
    `SELECT jev_status, role, policy_version, body FROM run_advice
     WHERE run_id = $1 AND purpose = 'finding' ORDER BY created_at`,
    [runId],
  );
  return rows;
}

const adviceActions = async (runId: string) =>
  (await findingAdvice(runId)).map((row) => [row.body.answer.review, row.body.answer.action]);

async function reply(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'`,
    [runId],
  );
  return rows.map((row) => row.content).join('\n');
}

const notes = () => readFile(join(root, 'notes.txt'), 'utf8');

describe('Critic → fix rounds', () => {
  it('sends correctness findings back to the same Builder, reruns the checks and the Critic, then asks to keep', async () => {
    await configureCheck(PASSING_CHECK);
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#bugreview', 'balanced');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');

    const rows = await children(runId);
    expect(rows.map((row) => row.role)).toEqual(['builder', 'critic', 'builder', 'critic']);
    const [first, , fix] = rows;
    expect(fix?.route.name).toBe(first?.route.name);
    expect(fix?.route.resumeKey).toBe(`${fix?.task_id}:builder`);
    expect(fix?.route.followUp).toContain('## Review findings to fix');
    for (const finding of BUG_FINDINGS) expect(fix?.route.followUp).toContain(finding);
    expect(await notes()).toContain('fixed the review findings');
    expect(await checkStatuses()).toEqual(['passed', 'passed']);

    const keep = asked.filter((approval) => approval.kind === 'accept');
    expect(keep).toHaveLength(1);
    expect(keep[0]!.options.map((option) => option.optionId)).not.toContain(
      CHECKPOINT_OPTION.fixFindings,
    );
    expect(keep[0]!.reason).toContain(
      "Fixed after 1 review round: the Critic's last review found no correctness problems; checks pass.",
    );

    const [advice] = await findingAdvice(runId);
    expect(advice).toMatchObject({
      jev_status: 'answered',
      role: 'critic',
      policy_version: POLICY_VERSION,
      body: { applied: 'jev', answer: { review: 1, fixable: 2, action: 'fix' } },
    });
    expect(script.calls.some((call) => call.questions.includes('finding_2'))).toBe(true);
    expect(orchestration.decisions.map((decision) => decision.kind)).toContain('finding');

    const text = await reply(runId);
    expect(text).toContain('Fixed the review findings after 1 earlier prompts.');
    expect(text).toContain('looks good');
    expect(text).toContain('Fixed after 1 review round');
  }, 120_000);

  it('fixes in round 2 by the rules alone, without Jev, at Full auto', async () => {
    await start({ jev: false });
    const { conversationId, runId } = await begin('Have it reviewed. #bugrounds 2', 'full-auto');
    const { asked } = await driveToEnd(t, conversationId, runId);
    expect(asked).toEqual([]);
    expect(await roles(runId)).toEqual([
      'builder',
      'critic',
      'builder',
      'critic',
      'builder',
      'critic',
    ]);
    const [, , firstFix, , secondFix] = await children(runId);
    expect(firstFix?.route.followUp).toContain(ROUND_FINDINGS[0]);
    expect(secondFix?.route.followUp).toContain(ROUND_FINDINGS[1]);
    expect(await adviceActions(runId)).toEqual([
      [1, 'fix'],
      [2, 'fix'],
    ]);
    expect((await findingAdvice(runId))[0]).toMatchObject({
      jev_status: 'not_connected',
      body: { applied: 'rules' },
    });
    expect(await reply(runId)).toContain(
      "Fixed after 2 review rounds: the Critic's last review found no correctness problems; no project checks ran.",
    );
  }, 120_000);

  it('stops early when the same findings come back after a fix', async () => {
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#stuckreview', 'balanced');
    const { asked } = await driveToEnd(t, conversationId, runId);
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder', 'critic']);
    expect(await adviceActions(runId)).toEqual([
      [1, 'fix'],
      [2, 'repeated'],
    ]);
    const [keep] = asked.filter((approval) => approval.kind === 'accept');
    expect(keep!.reason).toContain(
      'Still concerns after 1 round: the same findings came back after the fix',
    );
    const again = keep!.options.find((option) => option.optionId === CHECKPOINT_OPTION.fixFindings);
    expect(again?.name).toBe('Fix again');
  }, 120_000);

  it('stops after three fix rounds and shows the remaining concerns', async () => {
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#bugrounds 9', 'hands-off');
    const { asked } = await driveToEnd(t, conversationId, runId);
    expect(asked).toEqual([]);
    const spawned = await roles(runId);
    expect(spawned.filter((role) => role === 'builder')).toHaveLength(4);
    expect(spawned.filter((role) => role === 'critic')).toHaveLength(4);
    expect((await adviceActions(runId)).map(([, action]) => action)).toEqual([
      'fix',
      'fix',
      'fix',
      'cap',
    ]);
    expect(await reply(runId)).toContain(`Still concerns after 3 rounds: ${ROUND_FINDINGS[3]}`);
  }, 180_000);

  it('stops the loop when checks start failing after a fix and the check fixes cannot mend them', async () => {
    await configureCheck(FAILS_AFTER_REVIEW_FIX);
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#bugreview', 'full-auto');
    await driveToEnd(t, conversationId, runId);
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder', 'builder', 'builder']);
    expect(await checkStatuses()).toEqual(['passed', 'failed', 'failed', 'failed']);
    expect(await reply(runId)).toContain(
      'Stopped after 1 fix round: the checks failed after the fix and the check-fix turns could not fix them.',
    );
  }, 120_000);

  it('runs no fix turn for style-only concerns or a looks-good review', async () => {
    await start();
    const style = await begin('#stylereview', 'balanced');
    await driveToEnd(t, style.conversationId, style.runId);
    expect(await roles(style.runId)).toEqual(['builder', 'critic']);
    expect((await findingAdvice(style.runId))[0]?.body.answer).toMatchObject({
      fixable: 0,
      action: 'clean',
    });

    const good = await begin('', 'balanced');
    await driveToEnd(t, good.conversationId, good.runId);
    expect(await roles(good.runId)).toEqual(['builder', 'critic']);
    expect(await findingAdvice(good.runId)).toEqual([]);
  }, 120_000);

  it('lets Jev overrule the rules when it is sure a finding is not a bug', async () => {
    await start({ policy: { finding_1: 0.1, finding_2: 0.05 } });
    const { conversationId, runId } = await begin('#bugreview', 'hands-off');
    await driveToEnd(t, conversationId, runId);
    expect(await roles(runId)).toEqual(['builder', 'critic']);
  }, 120_000);

  it('offers "Fix these findings" on the keep card at Hands-on instead of fixing by itself', async () => {
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#bugreview', 'hands-on');
    let fixed = false;
    const answers: Answerer = (approval) => {
      if (approval.kind !== 'accept') return answerEverything(approval);
      if (fixed) return { optionId: CHECKPOINT_OPTION.keep };
      fixed = true;
      return { optionId: CHECKPOINT_OPTION.fixFindings };
    };
    const { asked } = await driveToEnd(t, conversationId, runId, answers);
    const [offer, after] = asked.filter((approval) => approval.kind === 'accept');
    expect(offer!.options.map((option) => [option.optionId, option.name])).toEqual([
      [CHECKPOINT_OPTION.keep, 'Keep'],
      [CHECKPOINT_OPTION.fixFindings, 'Fix these findings'],
      [CHECKPOINT_OPTION.fix, 'Ask for a fix'],
      [CHECKPOINT_OPTION.revert, 'Revert'],
    ]);
    expect(offer!.reason).toContain('The AI review found 2 correctness findings.');
    expect(after!.options.map((option) => option.optionId)).not.toContain(
      CHECKPOINT_OPTION.fixFindings,
    );
    expect(after!.reason).toContain('Fixed after 1 review round');
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder', 'critic']);
    expect(await notes()).toContain('fixed the review findings');
  }, 120_000);
});

describe('the task budget', () => {
  const stopAtBudget: Answerer = (approval) =>
    approval.kind === 'budget' ? { optionId: CHECKPOINT_OPTION.stop } : answerEverything(approval);

  it('refuses the first fix turn once the Builder and Critic spent the cap', async () => {
    await start({ policy: JEV_SAYS_BUGS, costCapUsd: 0.2004 });
    const { conversationId, runId } = await begin('#bugreview #cost', 'hands-off');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, stopAtBudget);
    expect(asked.map((approval) => approval.kind)).toEqual(['budget']);
    expect(orchestration).toMatchObject({ status: 'failed', budget: { exceeded: 'cost' } });
    expect(await roles(runId)).toEqual(['builder', 'critic']);
    expect((await findingAdvice(runId))[0]?.body.answer.fixable).toBe(2);
    expect(await reply(runId)).toContain(
      'The budget ran out before a fix turn for 2 correctness findings from the AI review',
    );
  }, 120_000);

  it('counts a fix turn against the cap and stops mid-loop before the next review', async () => {
    await start({ policy: JEV_SAYS_BUGS, costCapUsd: 0.1 });
    const { conversationId, runId } = await begin('#bugrounds 2 #fixcost', 'hands-off');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, stopAtBudget);
    expect(asked.map((approval) => approval.kind)).toEqual(['budget']);
    expect(orchestration).toMatchObject({ status: 'failed', budget: { exceeded: 'cost' } });
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder']);
    expect(orchestration.budget.costUsd).toBeGreaterThanOrEqual(0.2);
    expect(await reply(runId)).toContain(
      "1 fix round ran for the AI review's findings; the Critic did not review the last fix",
    );
  }, 120_000);
});
