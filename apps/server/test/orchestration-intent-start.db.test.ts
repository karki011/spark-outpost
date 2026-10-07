import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESEARCH_BRIEF } from '../src/orchestration/member-prompts.ts';
import { getRun } from '../src/persistence/runs.ts';
import { PLAN_REPLY_TRIGGER } from './fake-acp-plans.ts';
import {
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type JevScript,
  type Scenario,
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

async function run(scenario: Scenario) {
  const script: JevScript = { calls: [], scenario };
  harness = startOrchestrator(t, jevFetch(script));
  const { conversationId, runId } = await startScenario(t, root, scenario, null);
  const done = await driveToEnd(t, conversationId, runId);
  const children = await t.db.query<{ role: string }>(
    'SELECT role FROM runs WHERE parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  return { ...done, runId, script, children: children.rows.map((row) => row.role) };
}

async function sentPrompts(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ payload: string }>(
    `SELECT payload::text FROM run_protocol_log
     WHERE run_id = $1 AND method = 'session/prompt' AND direction = 'to_agent'`,
    [runId],
  );
  return rows.map((row) => row.payload).join('\n');
}

describe('the intent decides how the work starts', { timeout: 120_000 }, () => {
  it('sends research to the Reader only, with read-only instructions and next steps', async () => {
    const research: Scenario = {
      id: 'research',
      text: 'Investigate why the date divider jumps after midnight.',
      mode: 'do',
      destructive: 0.02,
      intent: 'research',
      intentProbabilities: { research: 0.9, bug_fix: 0.1 },
    };
    const { orchestration, runId, children, script } = await run(research);
    expect(orchestration.status).toBe('succeeded');
    expect(children).toEqual([]);
    expect(orchestration.crew.map((member) => member.role)).toEqual(['scout']);
    expect(await getRun(t.db, runId)).toMatchObject({ mode: 'ask', category: 'research' });
    const prompt = await sentPrompts(runId);
    expect(prompt).toContain(JSON.stringify(RESEARCH_BRIEF).slice(1, 60));
    const intake = script.calls.find((call) => call.questions.includes('intent'))!;
    expect(intake.questions).not.toContain('question');
  });

  it('builds a plan or design request at once, with no plan card and no plan turn', async () => {
    const plan: Scenario = {
      id: 'design',
      text: `Design the CSV export for Analytics. ${PLAN_REPLY_TRIGGER} #build`,
      mode: 'do',
      destructive: 0.02,
      intent: 'plan',
      intentProbabilities: { plan: 0.9, feature: 0.1 },
    };
    const { orchestration, asked, runId, children } = await run(plan);
    expect(orchestration.status).toBe('succeeded');
    expect(asked).toEqual([]);
    expect(children).toEqual(['builder']);
    expect(await getRun(t.db, runId)).toMatchObject({ category: 'plan' });
  });

  it('builds a bug fix with a Builder', async () => {
    const bug: Scenario = {
      id: 'bug',
      text: 'The divider shows the wrong day after midnight. Fix it. #build',
      mode: 'do',
      destructive: 0.02,
      intent: 'bug_fix',
    };
    const { orchestration, asked, runId, children } = await run(bug);
    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.kind)).not.toContain('plan');
    expect(children).toContain('builder');
    expect(await getRun(t.db, runId)).toMatchObject({ category: 'bug_fix' });
  });
});
