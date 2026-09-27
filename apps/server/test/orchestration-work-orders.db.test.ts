import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { conversationAuditRuns } from '../src/persistence/audit-summary.ts';
import { PLAN_SESSION_REASONS } from '../src/orchestration/plan-session.ts';
import { createTestDb, type TestDb } from './support.ts';

const COMPLEX = SCENARIOS[3] as Scenario;
const SHORT_PLAN: Scenario = {
  ...COMPLEX,
  id: 'short-plan',
  text: 'Split src/a.ts and src/b.ts into smaller modules. #build',
  depth: 'plan_execute',
  confidence: 0.65,
};

let t: TestDb;
let root: string;
let store: string | null = null;
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
  if (store) rmSync(store, { recursive: true, force: true });
  store = null;
});

async function run(
  scenario: Scenario,
  options: { sessions?: boolean; script?: Partial<JevScript> } = {},
) {
  const script: JevScript = { calls: [], scenario, ...options.script };
  if (options.sessions) store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  harness = startOrchestrator(t, jevFetch(script), store ? { sessions: store } : {});
  const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  return { orchestration, runId, conversationId };
}

interface ChildRow {
  id: string;
  role: string;
  model: string;
  effort: string;
  prompt: string;
  route: Record<string, unknown>;
}

async function children(runId: string): Promise<ChildRow[]> {
  const { rows } = await t.db.query<ChildRow>(
    `SELECT id, role, model, effort, prompt, route FROM runs
     WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function planSessionOf(runId: string) {
  const { rows } = await t.db.query<{ summary: string; plan_session: Record<string, unknown> }>(
    `SELECT body->>'summary' AS summary, body->'answer'->'planSession' AS plan_session
     FROM run_advice WHERE run_id = $1 AND purpose = 'route' AND role = 'builder'
     ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function reply(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'`,
    [runId],
  );
  return rows[0]?.content ?? '';
}

describe('work orders', () => {
  it('gives a fresh Builder its work order first and the Critic only the contract', async () => {
    const scenario = { ...COMPLEX, text: `${COMPLEX.text} #orders` };
    const { orchestration, runId } = await run(scenario);
    expect(orchestration.status).toBe('succeeded');
    const rows = await children(runId);
    const builder = rows.find((row) => row.role === 'builder')!;
    expect(builder.prompt.startsWith('Role: Builder.')).toBe(true);
    expect(builder.prompt.indexOf('## Work order')).toBeLessThan(
      builder.prompt.indexOf('## Request'),
    );
    expect(builder.prompt).toContain('Step 1: Update src/dates.ts for step 1');
    expect(builder.prompt).toContain('Acceptance contract:\n- src/dates.ts records step 1');
    expect(builder.prompt).toContain('src/dates.ts:1-2\n```\nexport function formatDay');
    expect(builder.prompt).toContain('Extra files read:');
    expect(builder.prompt).not.toContain('## Notes from the Architect');
    const critic = rows.find((row) => row.role === 'critic')!;
    expect(critic.prompt).toContain('## Acceptance contract\nStep 1: Update src/dates.ts');
    expect(critic.prompt).not.toContain('## Plan');
    expect(critic.prompt).not.toContain('Excerpts the Architect already read');
    expect(await reply(runId)).toContain('Had the work order.');
  }, 60_000);

  it('keeps the Architect’s notes when the reply has no work orders', async () => {
    const { runId } = await run(COMPLEX);
    const builder = (await children(runId)).find((row) => row.role === 'builder')!;
    expect(builder.prompt).not.toContain('## Work order');
    expect(builder.prompt).toContain('## Notes from the Architect');
  }, 60_000);
});

describe('plan and build in one session', () => {
  it('continues the Architect’s session as the Builder after the plan', async () => {
    const { orchestration, runId, conversationId } = await run(
      { ...SHORT_PLAN, text: `${SHORT_PLAN.text} #orders` },
      { sessions: true },
    );
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.crew.map((member) => member.role)).toEqual(['architect', 'builder']);
    const [architect, builder] = await children(runId);
    expect(architect).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(builder).toMatchObject({ model: 'sonnet' });
    expect(builder!.route.followUp).toMatch(/^Plan approved; implement it now\./);
    expect(builder!.route.resumeKey).toMatch(/:builder:/);
    const [decision] = await planSessionOf(runId);
    expect(decision?.plan_session).toMatchObject({
      same: true,
      reason: PLAN_SESSION_REASONS.oneBuilder,
    });
    expect(decision?.summary).toContain(
      `same session as the Architect (${PLAN_SESSION_REASONS.oneBuilder})`,
    );
    const sessions = await t.db.query<{ agent_key: string; session_id: string }>(
      `SELECT agent_key, session_id FROM provider_sessions WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]!.agent_key).toMatch(/:builder:/);
    expect(await reply(runId)).toContain('Continued the plan after 1 earlier prompts.');
    const steps = await t.db.query<{ name: string }>(
      `SELECT payload->>'stepName' AS name FROM run_events
       WHERE run_id = $1 AND type = 'STEP_STARTED'`,
      [builder!.id],
    );
    expect(steps.rows.map((row) => row.name)).toContain('Continued session');
  }, 60_000);

  it('starts a fresh Builder when the cheaper Builder pays for the re-read', async () => {
    const { runId } = await run(COMPLEX, { sessions: true });
    const [decision] = await planSessionOf(runId);
    expect(decision?.plan_session).toMatchObject({ same: false });
    expect(decision?.summary).toContain('fresh Builder (');
    const builder = (await children(runId)).find((row) => row.role === 'builder')!;
    expect(builder.route.followUp).toBeUndefined();
  }, 60_000);

  it('keeps separate Builders for parallel chains and records why', async () => {
    const scenario = { ...COMPLEX, text: `${COMPLEX.text} #parallel #chains #parallelchains` };
    const { orchestration, runId } = await run(scenario, {
      script: { parallel: { one_builder: 0.6, large_2: 0.1, same_folder: 0.95 } },
    });
    expect(orchestration.status).toBe('succeeded');
    const builders = orchestration.crew.filter((member) => member.role === 'builder');
    expect(builders.map((member) => member.parallelGroup)).toEqual(['g1', 'g1']);
    const decisions = await planSessionOf(runId);
    const recorded = decisions.filter((row) => row.plan_session);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.plan_session).toMatchObject({
      same: false,
      reason: PLAN_SESSION_REASONS.severalBuilders,
    });
    expect(builders.every((member) => !('followUp' in member))).toBe(true);
  }, 60_000);
});

describe('file reads per member', () => {
  it('records reads, re-reads of the Architect’s files and the extra-files line, and shows them in the audit', async () => {
    const scenario = { ...COMPLEX, text: `${COMPLEX.text} #orders #reads` };
    const { runId, conversationId } = await run(scenario);
    const rows = await children(runId);
    const architect = rows.find((row) => row.role === 'architect')!;
    const builder = rows.find((row) => row.role === 'builder')!;
    expect(architect.route).toMatchObject({ fileReads: 1 });
    expect(architect.route.rereads).toBeUndefined();
    expect(builder.route).toMatchObject({
      fileReads: 2,
      rereads: 1,
      extraReads: 'src/extra.ts (a helper)',
    });
    const audit = await conversationAuditRuns(t.db, conversationId);
    const builderRun = audit?.find((run) => run.runId === builder.id);
    expect(builderRun).toMatchObject({ fileReads: 2, rereads: 1 });
  }, 60_000);
});
