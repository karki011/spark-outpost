import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type Approval } from '@spark-outpost/contracts';
import {
  NORMAL,
  TRIVIAL,
  answerEverything,
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
  type Scenario,
} from './orchestration-support.ts';
import { NOTES_TEST_FILE, NOTES_TEST_SOURCE, TOTALS_FILE, TOTALS_SOURCE } from './fake-acp-laws.ts';
import { seedConversation, seedTurn } from './outcome-seed.ts';
import { startSparkTools } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

function start(scenario: Scenario) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }), { sessions: store });
}

async function commitFiles(files: Record<string, string>): Promise<void> {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('add', '.');
  git('commit', '-qm', 'laws fixture');
}

interface LawRow {
  answer: { law: string; source?: string; findings?: { text: string }[] };
  summary: string;
}

async function lawRows(runId: string, law: string): Promise<LawRow[]> {
  const { rows } = await t.db.query<LawRow>(
    `SELECT body->'answer' AS answer, body->>'summary' AS summary FROM run_advice
     WHERE run_id = $1 AND purpose = 'law' ORDER BY created_at`,
    [runId],
  );
  return rows.filter((row) => row.answer.law === law);
}

async function findingTexts(runId: string): Promise<string[]> {
  const rows = await lawRows(runId, 'findings');
  return rows.at(-1)?.answer.findings?.map((finding) => finding.text) ?? [];
}

async function keepCardLaws(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ laws: string[] }>(
    `SELECT payload->'checkpoint'->'laws' AS laws FROM approvals
     WHERE run_id = $1 AND kind = 'accept' ORDER BY created_at DESC LIMIT 1`,
    [runId],
  );
  return rows[0]?.laws ?? [];
}

async function run(scenario: Scenario, level: 'hands-off' | 'balanced' = 'hands-off') {
  start(scenario);
  const sent = await startScenario(t, root, scenario, level);
  const done = await driveToEnd(t, sent.conversationId, sent.runId);
  await harness?.stop();
  harness = null;
  return { ...sent, ...done };
}

const tagged = (scenario: Scenario, tags: string): Scenario => ({
  ...scenario,
  text: `${scenario.text} ${tags}`,
});

describe("Chesterton's fence", { timeout: 120_000 }, () => {
  it('flags an unexplained deletion on the keep card and in the reply when no Critic runs', async () => {
    await commitFiles({ [TOTALS_FILE]: TOTALS_SOURCE });
    const { runId, orchestration } = await run(tagged(TRIVIAL, '#removehelper'));
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder']);
    const flagged = 'Removed `helperTotals` from `src/totals.ts` — why?';
    expect(await findingTexts(runId)).toEqual([flagged]);
    expect(await keepCardLaws(runId)).toEqual([flagged]);
    const replies = await assistantReplies(t, runId);
    expect(replies.at(-1)).toContain(`Worth a look before you keep this:\n- ${flagged}`);
  });

  it('stays quiet when the Builder explains the removal', async () => {
    await commitFiles({ [TOTALS_FILE]: TOTALS_SOURCE });
    const { runId } = await run(tagged(TRIVIAL, '#removehelper #explainremoval'));
    expect(await findingTexts(runId)).toEqual([]);
    expect(await keepCardLaws(runId)).toEqual([]);
  });

  it('takes the removal from the Critic when one runs', async () => {
    await commitFiles({ [TOTALS_FILE]: TOTALS_SOURCE });
    const { runId, orchestration } = await run(
      tagged(TRIVIAL, '#removehelper #bigdiff #criticremoval'),
    );
    expect(orchestration.crew.map((member) => member.role)).toContain('critic');
    const rows = await lawRows(runId, 'findings');
    expect(rows.at(-1)?.summary).toContain('removals by critic');
    expect(await findingTexts(runId)).toContain(
      'Removed `helperTotals` from `src/totals.ts` — why?',
    );
  });
});

describe('Goodhart: checks run outside the agent', { timeout: 120_000 }, () => {
  it("flags a Builder that says the checks pass when Spark's own run fails", async () => {
    await setCheckCommands(t, root, ['node -e "process.exit(3)"']);
    const { runId } = await run(tagged(TRIVIAL, '#claimpass'));
    const texts = await findingTexts(runId);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(
      /^\w+ said the checks pass, but Spark's own run failed: `node -e "process.exit\(3\)"` exited 3\.$/,
    );
    expect(await keepCardLaws(runId)).toEqual(texts);
  });

  it('flags a weakened test, a config edit and a file outside the plan', async () => {
    await commitFiles({ [NOTES_TEST_FILE]: NOTES_TEST_SOURCE });
    const text = 'Fix the typo in src/notes.test.ts. #build #weakentest #strictoff';
    const { runId } = await run({ ...TRIVIAL, text });
    expect(await findingTexts(runId)).toEqual([
      'Weakened `src/notes.test.ts`: adds skip or only, 1 fewer assertion — why?',
      "Changed typecheck config `tsconfig.json`, which the task didn't ask for — why?",
      "Changed `notes.txt`, which the request and plan didn't name — check it.",
    ]);
  });
});

describe('Hofstadter estimates', { timeout: 240_000 }, () => {
  const planText = 'Improve the report page:\n- add a filter\n- add sorting\n- add paging #build';

  async function planCardEstimate(): Promise<string | null> {
    const scenario = { ...NORMAL, text: planText };
    start(scenario);
    const sent = await startScenario(t, root, scenario, 'hands-off');
    const { asked } = await driveToEnd(t, sent.conversationId, sent.runId);
    await harness?.stop();
    harness = null;
    const plan = asked.find((approval) => approval.title === 'Build this plan?');
    return plan?.payload.checkpoint?.estimate ?? null;
  }

  it('shows a rough estimate on the plan card, then a learned one after five similar runs', async () => {
    expect(await planCardEstimate()).toMatch(/^Rough estimate: ~\d+ min, ~\$\d+\.\d+ \(/);
    for (let index = 0; index < 4; index += 1) await run(NORMAL);
    expect(await planCardEstimate()).toMatch(
      /^Usually ~<1 min, ~\$\d+\.\d+ for a task like this \(<1 min, .+ over 5 similar runs\)$/,
    );
  });
});

describe('Parkinson budgets', { timeout: 120_000 }, () => {
  it('lets a simple Builder run past the old budget without stopping it', async () => {
    const scenario = tagged(TRIVIAL, '#manyreads 40');
    start(scenario);
    const sent = await startScenario(t, root, scenario, 'hands-off');
    const { asked, orchestration } = await driveToEnd(
      t,
      sent.conversationId,
      sent.runId,
      answerEverything,
    );
    expect(asked.filter((approval) => approval.kind === 'budget')).toEqual([]);
    const builder = orchestration.crew.find((member) => member.role === 'builder');
    expect(builder?.budget ?? null).toBeNull();
    expect(await lawRows(sent.runId, 'budget')).toEqual([]);
  });
});

interface SparkLaws {
  run: {
    estimate: { source: string } | null;
    budget: { text: string } | null;
    findings: { items: unknown[] } | null;
  } | null;
  demotions: { text: string }[];
}

async function seedBuilderOutcomes(model: string, label: string, passed: number, failed: number) {
  const conversationId = await seedConversation(t.db, t.workspaceId);
  for (let index = 0; index < passed + failed; index += 1) {
    const runId = await seedTurn(t.db, conversationId, { category: 'bug_fix' });
    await t.db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, status, mode,
         parent_run_id, role, route)
       SELECT $1, conversation_id, user_message_id, 'claude', $2, 'succeeded', 'do', id,
         'builder', $3
       FROM runs WHERE id = $4`,
      [randomUUID(), model, JSON.stringify({ modelLabel: label }), runId],
    );
    await t.db.query(`INSERT INTO task_outcomes (run_id, verdict) VALUES ($1, $2)`, [
      runId,
      index < failed ? 'bad' : 'good',
    ]);
  }
}

describe('Peter principle demotions', { timeout: 120_000 }, () => {
  it('routes a bug fix away from a model with a low recent pass rate', async () => {
    await seedBuilderOutcomes('sonnet', 'Sonnet 5', 5, 7);
    const { orchestration, conversationId } = await run(NORMAL);
    const builder = orchestration.crew.find((member) => member.role === 'builder');
    expect(builder?.model).not.toBe('sonnet');
    expect(builder?.routeNote).toContain(
      'Sonnet 5 has passed 42% of recent bug fixes here (5/12; the 60% floor), so Spark routed this work elsewhere',
    );

    const tools = await startSparkTools(t, { conversationId });
    try {
      const laws = (await tools.call('spark_laws')).json<SparkLaws>();
      expect(laws.demotions.map((entry) => entry.text)).toEqual([
        'Sonnet 5 has passed 42% of recent bug fixes here (5/12; the 60% floor)',
      ]);
      expect(laws.run?.estimate?.source).toBe('rough');
      expect(laws.run?.budget ?? null).toBeNull();
      expect(laws.run?.findings?.items).toEqual([]);
    } finally {
      await tools.close();
    }
  });

  it('keeps a pinned model and only notes the demotion', async () => {
    await seedBuilderOutcomes('sonnet', 'Sonnet 5', 5, 7);
    start(NORMAL);
    const sent = await startScenario(t, root, NORMAL, 'hands-off', 'pinned');
    const { orchestration } = await driveToEnd(t, sent.conversationId, sent.runId);
    const builder = orchestration.crew.find((member) => member.role === 'builder');
    expect(builder?.model).toBe('sonnet');
    expect(builder?.routeNote).toContain('pinned, so Spark kept it');
  });
});
