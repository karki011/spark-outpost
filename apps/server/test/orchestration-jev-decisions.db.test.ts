import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Orchestration, OrchestrationDecision } from '@spark-outpost/contracts';
import { ONE_SPOT_REASON } from '../src/orchestration/depth.ts';
import {
  SCENARIOS,
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

const COMPLEX = SCENARIOS[3] as Scenario;
const RISKY = SCENARIOS[4] as Scenario;

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

async function run(
  scenario: Scenario,
  script: Omit<JevScript, 'calls' | 'scenario'> = {},
  routing: 'auto' | 'pinned' = 'auto',
) {
  const full: JevScript = { ...script, calls: [], scenario };
  harness = startOrchestrator(t, jevFetch(full));
  const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off', routing);
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  return { orchestration, script: full };
}

const decision = (orchestration: Orchestration, kind: string, role: string | null = null) =>
  orchestration.decisions.find(
    (entry) => entry.kind === kind && (role === null || entry.role === role),
  ) as OrchestrationDecision;

const planned: Scenario = {
  ...COMPLEX,
  id: 'planned',
  depth: 'plan_execute',
  scope: 'few_modules',
  complexity: 2,
};

describe('the scope question', () => {
  it('stores Jev’s scope on the intake decision', async () => {
    const { orchestration, script } = await run(planned);
    expect(script.calls[0]?.questions).toContain('scope');
    expect(decision(orchestration, 'intake').answer).toMatchObject({ scope: 'few_modules' });
  }, 60_000);

  it('skips the Architect when Jev places the change in one spot with confidence', async () => {
    const { orchestration } = await run({ ...planned, scope: 'one_spot', scopeConfidence: 0.8 });
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.depth).toBe('execute');
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder']);
    expect(decision(orchestration, 'intake').answer.depthNote).toEqual({
      depth: 'execute',
      reason: ONE_SPOT_REASON,
    });
  }, 60_000);
});

describe('Jev picking the Architect', () => {
  it('acts on a cheaper confident pick and records the rule’s pick beside it', async () => {
    const { orchestration } = await run(planned, {
      architect: { model: 'sonnet', effort: 2, confidence: 0.85 },
    });
    expect(orchestration.crew[0]).toMatchObject({
      role: 'architect',
      model: 'sonnet',
      effort: 'high',
      routedBy: 'jev',
    });
    const route = decision(orchestration, 'route', 'architect');
    expect(route.jevStatus).toBe('answered');
    expect(route.gate).toMatchObject({ decision: 'act', actAt: 0.8 });
    expect(route.answer).toMatchObject({
      rule: 'vague',
      rulePick: { model: 'opus[1m]', effort: 'high' },
      autoWouldUse: { model: 'sonnet', effort: 'high' },
    });
  }, 60_000);

  it('keeps the rule below the gate', async () => {
    const { orchestration } = await run(planned, {
      architect: { model: 'sonnet', effort: 1, confidence: 0.45 },
    });
    expect(orchestration.crew[0]).toMatchObject({ model: 'opus[1m]', effort: 'high' });
    expect(decision(orchestration, 'route', 'architect').summary).toContain(
      'Auto would have used Sonnet 5 · medium',
    );
  }, 60_000);

  it('keeps the top tier for destructive work however sure Jev is', async () => {
    const { orchestration } = await run(RISKY, {
      architect: { model: 'sonnet', effort: 2, confidence: 0.99 },
    });
    expect(orchestration.crew[0]).toMatchObject({ role: 'architect', model: 'opus[1m]' });
    expect(decision(orchestration, 'route', 'architect').answer.rule).toBe('destructive');
    expect(orchestration.crew.some((member) => member.role === 'critic')).toBe(true);
  }, 60_000);

  it('lets a pinned model win and records what Auto would have used', async () => {
    const { orchestration } = await run(
      planned,
      { architect: { model: 'haiku', effort: 0, confidence: 0.95 } },
      'pinned',
    );
    expect(orchestration.crew[0]).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(orchestration.crew[0]?.autoWouldUse).toMatchObject({ model: 'haiku', effort: 'low' });
  }, 60_000);
});

describe('Jev deciding parallelism', () => {
  const tagged = (tags: string): Scenario => ({ ...planned, text: `${planned.text} ${tags}` });
  const builderGroups = (orchestration: Orchestration) =>
    orchestration.crew
      .filter((member) => member.role === 'builder')
      .map((member) => member.parallelGroup ?? null);

  it('keeps hinted steps in order when Jev is sure they depend on each other', async () => {
    const { orchestration, script } = await run(tagged('#parallel'), {
      parallel: { independent_2: 0.1 },
    });
    expect(orchestration.status).toBe('succeeded');
    expect(builderGroups(orchestration)).toEqual([null]);
    expect(script.calls.some((call) => call.questions.includes('large_3'))).toBe(true);
    const parallel = decision(orchestration, 'parallel');
    expect(parallel.applied).toBe('jev');
    expect(parallel.answer.groups).toEqual([
      { steps: [1, 2], parallel: false, rules: true, source: 'jev' },
    ]);
    expect(parallel.summary).toMatch(/^Parallel: none · the rules would have run steps 2 and 3/);
  }, 60_000);

  it('gives small steps their own Builders when Jev is sure they are large', async () => {
    const { orchestration } = await run(tagged('#parallel #small'), {
      parallel: { independent_2: 0.9, large_2: 0.95, large_3: 0.9 },
    });
    expect(orchestration.status).toBe('succeeded');
    expect(builderGroups(orchestration)).toEqual([null, 'g1', 'g1']);
    expect(decision(orchestration, 'parallel').answer.groups).toEqual([
      { steps: [1, 2], parallel: true, rules: false, source: 'jev' },
    ]);
  }, 60_000);

  it('uses the Architect’s lines when Jev is unsure', async () => {
    const { orchestration } = await run(tagged('#parallel'), {
      parallel: { independent_2: 0.6, large_2: 0.5, large_3: 0.4 },
    });
    expect(builderGroups(orchestration)).toEqual([null, 'g1', 'g1']);
    expect(decision(orchestration, 'parallel')).toMatchObject({
      applied: 'rules',
      answer: { groups: [{ steps: [1, 2], parallel: true, rules: true, source: 'rules' }] },
    });
  }, 60_000);
});
