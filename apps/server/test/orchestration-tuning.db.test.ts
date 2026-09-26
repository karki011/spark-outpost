import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  return { orchestration, runId, script };
}

async function childPrompts(runId: string, role: string): Promise<string[]> {
  const { rows } = await t.db.query<{ prompt: string }>(
    `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = $2 ORDER BY created_at`,
    [runId, role],
  );
  return rows.map((row) => row.prompt);
}

const planned = (text: string, confidence: number): Scenario => ({
  ...COMPLEX,
  id: 'planned',
  text,
  depth: 'plan_execute',
  confidence,
});

describe('a request that is already a plan', () => {
  it('runs one Builder without an Architect and records why', async () => {
    const scenario = planned(
      'Move formatDay out of src/a.ts into src/b.ts and update src/c.ts. #build',
      0.78,
    );
    const { orchestration, runId } = await run(scenario);
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.depth).toBe('execute');
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder']);
    expect(orchestration.crew[0]!.runId).toBe(runId);
    const intake = orchestration.decisions.find((decision) => decision.kind === 'intake');
    expect(intake?.summary).toBe(
      'plan → execute · multi-file → execute: The request names its 3 files, so one Builder works from it without an Architect.',
    );
    expect(intake?.answer.depthNote).toEqual({
      depth: 'execute',
      reason: 'The request names its 3 files, so one Builder works from it without an Architect.',
    });
  }, 60_000);

  it('still plans when Jev is less sure, with Sonnet as the Architect for a short plan', async () => {
    const { orchestration, runId } = await run(
      planned('Split src/a.ts and src/b.ts into smaller modules. #build', 0.65),
    );
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.crew.map((member) => member.role)).toEqual(['architect', 'builder']);
    expect(orchestration.crew[0]).toMatchObject({ model: 'sonnet', effort: 'high' });
    const route = orchestration.decisions.find(
      (decision) => decision.kind === 'route' && decision.role === 'architect',
    );
    expect(route?.answer.rule).toBe('short plan');
    const [builder] = await childPrompts(runId, 'builder');
    expect(builder).toContain(
      '## Notes from the Architect\nsrc/dates.ts exports formatDay(date: Date): string.',
    );
    expect(builder).toContain('Step 3: Update src/turns.ts for step 3');
    expect(orchestration.crew[1]?.planStep?.split('\n')).toHaveLength(3);
  }, 60_000);
});

describe('parallel steps that are not worth their own Builders', () => {
  it('runs small tagged steps in the one Builder that carries the plan', async () => {
    const { orchestration } = await run({ ...COMPLEX, text: `${COMPLEX.text} #parallel #small` });
    expect(orchestration.status).toBe('succeeded');
    const builders = orchestration.crew.filter((member) => member.role === 'builder');
    expect(builders.map((member) => member.parallelGroup ?? null)).toEqual([null]);
    expect(await readFile(join(root, 'src/turns.ts'), 'utf8')).toBe('step 3\n');
  }, 60_000);
});
