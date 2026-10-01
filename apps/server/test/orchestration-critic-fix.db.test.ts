import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type CheckBody, type InvolvementLevel } from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../src/advisor/policy.ts';
import { nextCallUsd } from '../src/orchestration/budget-check.ts';
import { CRITIC_FIX_LEAD } from '../src/orchestration/context.ts';
import {
  BUG_FINDINGS,
  EDGE_FINDINGS,
  HARDENING_FINDINGS,
  ROUND_FINDINGS,
} from './fake-acp-roles.ts';
import {
  TRIVIAL,
  answerEverything,
  artifactBodies,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  setCheckCommands,
  startOrchestrator,
  startScenario,
  withTag,
  type Answerer,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const REVIEWED: Scenario = { ...TRIVIAL, review: 0.95 };
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
  toolCallLimit?: number;
  fixRound?: { toolCalls?: number; activeMs?: number };
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
    ...(options.toolCallLimit === undefined
      ? {}
      : { budget: { toolCallLimit: options.toolCallLimit }, budgetPollMs: NO_BUDGET_POLL }),
    ...(options.fixRound ? { fixRound: options.fixRound } : {}),
  });
}

function begin(tag: string, level: InvolvementLevel) {
  return startScenario(t, root, withTag(REVIEWED, tag), level);
}

function drive(
  conversationId: string,
  runId: string,
  answer: Answerer = answerEverything,
  timeoutMs = 110_000,
) {
  return driveToEnd(t, conversationId, runId, answer, timeoutMs);
}

async function configureCheck(source: string): Promise<void> {
  await writeFile(join(root, 'check.mjs'), source);
  await setCheckCommands(t, root, ['node check.mjs']);
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
  return (await artifactBodies<CheckBody>(t, 'check')).map((body) => body.status);
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
  return (await assistantReplies(t, runId)).join('\n');
}

const notes = () => readFile(join(root, 'notes.txt'), 'utf8');

describe('Critic → fix rounds', () => {
  it('sends correctness findings back to the same Builder at Auto-edit, reruns the checks and the Critic', async () => {
    await configureCheck(PASSING_CHECK);
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#bugreview', 'hands-off');
    const { asked, orchestration } = await drive(conversationId, runId);
    expect(orchestration.status).toBe('succeeded');

    const rows = await children(runId);
    expect(rows.map((row) => row.role)).toEqual(['builder', 'critic', 'builder', 'critic']);
    const [first, , fix] = rows;
    expect(fix?.route.name).toBe(first?.route.name);
    expect(fix?.route.resumeKey).toBe(`${fix?.task_id}:builder`);
    expect(fix?.route.followUp).toContain('## Review findings to fix');
    expect(fix?.route.followUp).toContain(CRITIC_FIX_LEAD);
    for (const finding of BUG_FINDINGS) expect(fix?.route.followUp).toContain(finding);
    expect(BUG_FINDINGS.length).toBeGreaterThan(1);
    expect(rows.filter((row) => row.role === 'builder')).toHaveLength(2);
    expect(await notes()).toContain('fixed the review findings');
    expect(await checkStatuses()).toEqual(['passed', 'passed']);

    expect(asked.filter((approval) => approval.kind === 'accept')).toEqual([]);

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
    expect(text).toContain(
      "Fixed after 1 review round: the Critic's last review found no correctness problems; checks pass.",
    );
  }, 120_000);

  it('fixes in round 2 by the rules alone, without Jev, at Full auto', async () => {
    await start({ jev: false });
    const { conversationId, runId } = await begin('Have it reviewed. #bugrounds 2', 'full-auto');
    const { asked } = await drive(conversationId, runId);
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
    const { conversationId, runId } = await begin('#stuckreview', 'hands-off');
    await drive(conversationId, runId);
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder', 'critic']);
    expect(await adviceActions(runId)).toEqual([
      [1, 'fix'],
      [2, 'repeated'],
    ]);
    expect(await reply(runId)).toContain(
      'Still concerns after 1 round: the same findings came back after the fix',
    );
  }, 120_000);

  it('stops after three fix rounds, shows the remaining concerns and asks to keep at Auto-edit', async () => {
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#bugrounds 9', 'hands-off');
    const { asked } = await drive(conversationId, runId, answerEverything, 170_000);
    expect(asked.map((approval) => approval.kind)).toEqual(['accept']);
    expect(asked[0]!.reason).toContain('Automatic asks because the Critic still has concerns.');
    expect(asked[0]!.options.map((option) => option.optionId)).toContain(
      CHECKPOINT_OPTION.fixFindings,
    );
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
    await drive(conversationId, runId);
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder', 'builder', 'builder']);
    expect(await checkStatuses()).toEqual(['passed', 'failed', 'failed', 'failed']);
    expect(await reply(runId)).toContain(
      'Stopped after 1 fix round: the checks failed after the fix and the check-fix turns could not fix them.',
    );
  }, 120_000);

  it('runs no fix turn for style-only concerns or a looks-good review', async () => {
    await start();
    const style = await begin('#stylereview', 'balanced');
    await drive(style.conversationId, style.runId);
    expect(await roles(style.runId)).toEqual(['builder', 'critic']);
    expect((await findingAdvice(style.runId))[0]?.body.answer).toMatchObject({
      fixable: 0,
      action: 'clean',
    });

    const good = await begin('', 'balanced');
    await drive(good.conversationId, good.runId);
    expect(await roles(good.runId)).toEqual(['builder', 'critic']);
    expect(await findingAdvice(good.runId)).toEqual([]);
  }, 120_000);

  it("reports the rerun's hardening findings instead of fixing them at Auto-edit, even when Jev says bug (N2)", async () => {
    await start({ policy: { finding_1: 0.95, finding_2: 0.95, finding_3: 0.95 } });
    const { conversationId, runId } = await begin('#hardeningreview', 'hands-off');
    const { asked, orchestration } = await drive(conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await roles(runId)).toEqual(['builder', 'critic']);
    expect(asked.filter((approval) => approval.kind === 'accept')).toEqual([]);
    expect((await findingAdvice(runId))[0]?.body.answer).toMatchObject({
      fixable: 0,
      action: 'clean',
    });
    const text = await reply(runId);
    expect(text).toContain('Not fixed automatically: 3 AI review suggestions about hardening');
    expect(text).toContain(HARDENING_FINDINGS[0]!.slice(0, 60));
  }, 120_000);

  it('runs no fix round at Full auto for tagged hardening and style findings on a passing build, even when Jev says bug (B3)', async () => {
    await configureCheck("console.log('ok');\n");
    await start({ policy: { finding_1: 0.95, finding_2: 0.95, finding_3: 0.95 } });
    const { conversationId, runId } = await begin('#edgereview', 'full-auto');
    const { orchestration } = await drive(conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await roles(runId)).toEqual(['builder', 'critic']);
    expect(await checkStatuses()).toEqual(['passed']);
    expect((await findingAdvice(runId))[0]?.body.answer).toMatchObject({
      fixable: 0,
      action: 'clean',
    });
    expect(await reply(runId)).toContain('Not fixed automatically: 2 AI review suggestions');
  }, 120_000);

  it('still reports hardening findings when the Critic says looks good (B3)', async () => {
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#edgegood', 'full-auto');
    await drive(conversationId, runId);
    expect(await roles(runId)).toEqual(['builder', 'critic']);
    expect(await findingAdvice(runId)).toEqual([]);
    const text = await reply(runId);
    expect(text).toContain('Not fixed automatically: 2 AI review suggestions');
    expect(text).toContain(EDGE_FINDINGS[0]!.slice(0, 60));
  }, 120_000);

  it('lets Jev overrule the rules when it is sure a finding is not a bug', async () => {
    await start({ policy: { finding_1: 0.1, finding_2: 0.05 } });
    const { conversationId, runId } = await begin('#bugreview', 'hands-off');
    await drive(conversationId, runId);
    expect(await roles(runId)).toEqual(['builder', 'critic']);
  }, 120_000);

  it('offers "Fix these findings" on the keep card at Review each step instead of fixing by itself', async () => {
    await start({ policy: JEV_SAYS_BUGS });
    const { conversationId, runId } = await begin('#bugreview', 'balanced');
    let fixed = false;
    const answers: Answerer = (approval) => {
      if (approval.kind !== 'accept') return answerEverything(approval);
      if (fixed) return { optionId: CHECKPOINT_OPTION.keep };
      fixed = true;
      return { optionId: CHECKPOINT_OPTION.fixFindings };
    };
    const { asked, orchestration } = await drive(conversationId, runId, answers);
    const [offer, after] = asked.filter((approval) => approval.kind === 'accept');
    expect(offer!.options.map((option) => [option.optionId, option.name])).toEqual([
      [CHECKPOINT_OPTION.keep, 'Keep'],
      [CHECKPOINT_OPTION.fixFindings, 'Fix these findings'],
      [CHECKPOINT_OPTION.fix, 'Ask for a fix'],
      [CHECKPOINT_OPTION.revert, 'Revert'],
    ]);
    expect(offer!.reason).toContain('The AI review found 2 correctness findings.');
    expect(after).toBeUndefined();
    const kept = orchestration.checkpoints.find(
      (approval) => approval.kind === 'accept' && approval.decidedBy === 'level',
    );
    expect(kept?.payload.checkpoint?.keptBy).toBe('balanced');
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder', 'critic']);
    expect(await notes()).toContain('fixed the review findings');
  }, 120_000);
});

describe('the task budget', () => {
  const stopAtBudget: Answerer = (approval) =>
    approval.kind === 'budget' ? { optionId: CHECKPOINT_OPTION.stop } : answerEverything(approval);

  it('refuses the first fix turn once the Builder and Critic spent the cap, and Stop ends on the keep card', async () => {
    const builderAndCriticFloor = 0.2 + nextCallUsd('claude', 'sonnet');
    await start({ policy: JEV_SAYS_BUGS, costCapUsd: builderAndCriticFloor + 0.0002 });
    const { conversationId, runId } = await begin('#bugreview #cost', 'hands-off');
    const { asked, orchestration } = await drive(conversationId, runId, stopAtBudget);
    expect(asked.map((approval) => approval.kind)).toEqual(['budget', 'accept']);
    expect(orchestration).toMatchObject({ status: 'succeeded', budget: { exceeded: 'cost' } });
    expect(await roles(runId)).toEqual(['builder', 'critic']);
    expect((await findingAdvice(runId))[0]?.body.answer.fixable).toBe(2);
    expect(await reply(runId)).toContain(
      'The budget ran out before a fix turn for 2 correctness findings from the AI review',
    );
  }, 120_000);

  it('rolls a fix round cut by the run cost cap back to the state that passed the checks and asks to keep (N2)', async () => {
    await configureCheck(PASSING_CHECK);
    await start({ policy: JEV_SAYS_BUGS, costCapUsd: 0.1 });
    const { conversationId, runId } = await begin('#bugrounds 2 #fixcost', 'hands-off');
    const { asked, orchestration } = await drive(conversationId, runId, stopAtBudget);
    const cards = asked.filter((approval) => approval.kind !== 'execute');
    expect(cards.map((approval) => approval.kind)).toEqual(['accept']);
    expect(cards[0]!.reason).toContain('Automatic asks because the Critic still has concerns.');
    expect(cards[0]!.reason).toContain(
      "Stopped fix round 1: the run's cost budget ran out, so Spark Outpost rolled its edits back to the last state that passed the checks.",
    );
    expect(orchestration).toMatchObject({ status: 'succeeded', budget: { exceeded: 'cost' } });
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder']);
    expect(orchestration.budget.costUsd).toBeGreaterThanOrEqual(0.2);
    expect(await notes()).not.toContain('fixed the review findings');
    expect(await reply(runId)).toContain('Stopped fix round 1');
  }, 120_000);

  it('rolls a fix round cut by its own budget back to the last passing state and ends on the keep card (N2)', async () => {
    await configureCheck(PASSING_CHECK);
    await start({ policy: JEV_SAYS_BUGS, fixRound: { toolCalls: 1 } });
    const { conversationId, runId } = await begin('#bugrounds 9 #slowfix', 'hands-off');
    const { asked, orchestration } = await drive(conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.budget.exceeded).toBeNull();
    expect(await roles(runId)).toEqual(['builder', 'critic', 'builder']);
    const cards = asked.filter((approval) => approval.kind !== 'execute');
    expect(cards.map((approval) => approval.kind)).toEqual(['accept']);
    const keep = cards[0]!;
    expect(keep.reason).toContain(
      "Stopped fix round 1: fix round 1's own tool-call budget ran out, so Spark Outpost rolled its edits back to the last state that passed the checks.",
    );
    expect(keep.reason).toContain(`Still open: ${ROUND_FINDINGS[0]}`);
    expect(keep.options.map((option) => option.optionId)).toContain(CHECKPOINT_OPTION.fixFindings);
    expect(await notes()).not.toContain('fixed the review findings');
    expect(await notes()).toContain('step 1');
  }, 120_000);

  it('does not start a fix round by itself when too little of the run budget is left for one', async () => {
    await start({ policy: JEV_SAYS_BUGS, fixRound: { toolCalls: 10_000 } });
    const { conversationId, runId } = await begin('#bugreview', 'hands-off');
    const { asked, orchestration } = await drive(conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await roles(runId)).toEqual(['builder', 'critic']);
    expect(asked.map((approval) => approval.kind)).toEqual(['accept']);
    expect(asked[0]!.reason).toContain(
      "Did not start fix round 1: too little of the run's tool-call budget was left for one",
    );
    expect(asked[0]!.reason).toContain(`Still open: ${BUG_FINDINGS[0]}`);
  }, 120_000);
});
