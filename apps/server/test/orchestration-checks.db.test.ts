import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckBody } from '@spark-outpost/contracts';
import { allowedForRun } from '../src/persistence/approvals.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { createProject } from '../src/projects/projects.ts';
import { REVIEW_INTENT_REASON } from '../src/orchestration/depth.ts';
import type { LaneOptions } from '../src/orchestration/placement.ts';
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
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const TRIVIAL = SCENARIOS[1] as Scenario;
const COMPLEX = SCENARIOS[3] as Scenario;

const FAILS_UNTIL_FIXED = `import { existsSync } from 'node:fs';
if (!existsSync('fixed.txt')) {
  console.error('expected fixed.txt to exist');
  process.exit(1);
}
console.log('all good');
`;

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

function start(scenario: Scenario, lanes?: LaneOptions) {
  const script: JevScript = { calls: [], scenario };
  harness = startOrchestrator(t, jevFetch(script), {
    sessions: store,
    ...(lanes ? { lanes } : {}),
  });
}

async function configureChecks(commands: string[] | null): Promise<void> {
  const { project } = await createProject(t.db, t.workspaceId, root);
  await t.db.query('UPDATE projects SET check_commands = $2 WHERE id = $1', [project.id, commands]);
}

interface ChildRow {
  role: string;
  route: Record<string, string | undefined>;
  status: string;
  created_at: Date;
  finished_at: Date;
  task_id: string;
}

async function children(runId: string): Promise<ChildRow[]> {
  const { rows } = await t.db.query<ChildRow>(
    `SELECT role, route, status, created_at, finished_at, task_id FROM runs
     WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function checkBodies(): Promise<CheckBody[]> {
  const { rows } = await t.db.query<{ body: CheckBody }>(
    `SELECT body FROM run_artifacts WHERE kind = 'check' ORDER BY version`,
  );
  return rows.map((row) => row.body);
}

async function fixRunId(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>(
    `SELECT id FROM runs WHERE parent_run_id = $1 AND role = 'builder'`,
    [runId],
  );
  return rows[0]!.id;
}

async function lastReply(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ text: string }>(
    `SELECT string_agg(payload->>'delta', '' ORDER BY seq) AS text FROM run_events
     WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'`,
    [runId],
  );
  return rows[0]?.text ?? '';
}

describe('checks after a Builder lands', () => {
  it('runs the project checks, resumes the Builder to fix a failure, and records it all', async () => {
    await writeFile(join(root, 'check.mjs'), FAILS_UNTIL_FIXED);
    await configureChecks(['node check.mjs']);
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');

    const bodies = await checkBodies();
    expect(bodies.map((body) => [body.round, body.status, body.name])).toEqual([
      [1, 'failed', 'Bolt'],
      [2, 'passed', 'Bolt'],
    ]);
    expect(bodies[0]!.results[0]).toMatchObject({ command: 'node check.mjs', exitCode: 1 });
    expect(bodies[0]!.results[0]!.outputTail).toContain('expected fixed.txt to exist');

    const [fix] = await children(runId);
    expect(fix?.role).toBe('builder');
    expect(fix?.route.name).toBe('Bolt');
    expect(fix?.route.resumeKey).toBe(`${fix?.task_id}:builder:Bolt`);
    expect(fix?.route.followUp).toContain('## Failing checks');
    expect(fix?.route.followUp).toContain('expected fixed.txt to exist');
    expect(await readFile(join(root, 'fixed.txt'), 'utf8')).toBe('fixed\n');

    const { rows: fixRuns } = await t.db.query<{ id: string }>(
      `SELECT id FROM runs WHERE parent_run_id = $1 AND role = 'builder'`,
      [runId],
    );
    expect(await lastReply(fixRuns[0]!.id)).toContain('after 1 earlier prompts');

    const { rows: audit } = await t.db.query<{ direction: string; payload: { outcome: string } }>(
      `SELECT direction, payload FROM run_protocol_log WHERE run_id = $1 AND kind = 'check'
       ORDER BY seq`,
      [runId],
    );
    expect(audit.map((row) => [row.direction, row.payload.outcome])).toEqual([
      ['harness', 'failed'],
      ['harness', 'passed'],
    ]);

    const detail = await getConversationDetail(t.db, conversationId);
    const labels = detail?.tasks.flatMap((task) => task.items.map((item) => item.label)) ?? [];
    expect(labels.some((label) => label.startsWith('Checks failed for Bolt'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Checks passed for Bolt'))).toBe(true);
    const failed = detail?.tasks[0]?.items.find((item) => item.label.startsWith('Checks failed'));
    expect(failed?.output).toContain('expected fixed.txt to exist');

    const { rows: sessions } = await t.db.query<{ close_reason: string | null }>(
      `SELECT close_reason FROM provider_sessions WHERE agent_key LIKE 'key:%'`,
    );
    expect(sessions.map((row) => row.close_reason)).toEqual(['orchestration finished']);
  });

  it('asks before running a check at Balanced and reports a pass', async () => {
    await writeFile(join(root, 'check.mjs'), "console.log('ok');\n");
    await configureChecks(['node check.mjs']);
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'balanced');
    const { asked } = await driveToEnd(t, conversationId, runId);
    expect(asked.map((approval) => approval.title)).toContain('Run check: node check.mjs');
    const bodies = await checkBodies();
    expect(bodies.map((body) => body.status)).toEqual(['passed']);
    expect(await children(runId)).toEqual([]);
  });

  it('lets "Allow for this run" on a Builder edit cover the same Builder fixing its checks', async () => {
    await writeFile(join(root, 'check.mjs'), FAILS_UNTIL_FIXED);
    await configureChecks(['node check.mjs']);
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'balanced');
    const { asked } = await driveToEnd(t, conversationId, runId, (approval) => {
      const decision = answerEverything(approval);
      return decision && approval.kind === 'edit' ? { ...decision, scope: 'run' } : decision;
    });
    expect(asked.filter((approval) => approval.kind === 'edit')).toHaveLength(1);
    const [fix] = await children(runId);
    expect(fix?.route.resumeKey).toBeDefined();
    const { rows } = await t.db.query<{ decided_by: string }>(
      `SELECT a.decided_by FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.kind = 'edit'`,
      [runId],
    );
    expect(rows.map((row) => row.decided_by)).toEqual(['run_rule']);
    expect(await readFile(join(root, 'fixed.txt'), 'utf8')).toBe('fixed\n');

    const fixId = await fixRunId(runId);
    expect(await allowedForRun(t.db, fixId)).toHaveLength(1);
    await t.db.query(`UPDATE runs SET route = route || '{"name":"Rivet"}' WHERE id = $1`, [fixId]);
    expect(await allowedForRun(t.db, fixId)).toEqual([]);
  });

  it('runs no checks when the project turns them off', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'exit 1' } }));
    await configureChecks([]);
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    expect(await checkBodies()).toEqual([]);
  });
});

describe('Critic alongside Builders and chains', () => {
  it('builds large chains in worktrees, checks the merged tree and reviews it once', async () => {
    await writeFile(join(root, 'check.mjs'), "console.log('ok');\n");
    await configureChecks(['node check.mjs']);
    start(COMPLEX, { placement: 'worktree' });
    const scenario = { ...COMPLEX, text: `${COMPLEX.text} #parallel #chains #sleepstep 3` };
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');

    const rows = await children(runId);
    const builders = rows
      .filter((row) => row.role === 'builder')
      .sort((a, b) => (a.route.name ?? '').localeCompare(b.route.name ?? ''));
    const critics = rows.filter((row) => row.role === 'critic');
    expect(builders.map((row) => [row.route.name, row.route.planStep?.split('\n').length])).toEqual(
      [
        ['Bolt', 4],
        ['Rivet', 2],
      ],
    );
    expect(new Set(builders.map((row) => row.route.parallelGroup))).toEqual(new Set(['g1']));
    expect(builders.every((row) => row.route.copy?.startsWith('spark/'))).toBe(true);
    expect(critics.map((row) => row.route.name)).toEqual(['Hawk']);
    const lastBuilder = Math.max(...builders.map((row) => row.finished_at.getTime()));
    expect(critics[0]!.created_at.getTime()).toBeGreaterThan(lastBuilder);
    const { rows: prompts } = await t.db.query<{ prompt: string }>(
      `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'critic'`,
      [runId],
    );
    expect(prompts[0]!.prompt).toContain("Bolt and Rivet's change for steps 1, 2, 3.");
    expect(prompts[0]!.prompt).toContain('src/turns.ts');

    const bodies = await checkBodies();
    const lanes = bodies.slice(0, 2).map((body) => [body.name, body.copy, body.status]);
    expect(lanes.sort()).toEqual([
      ['Bolt', 'Bolt', 'passed'],
      ['Rivet', 'Rivet', 'passed'],
    ]);
    expect(bodies.slice(2).map((body) => [body.name, body.copy])).toEqual([
      ['Bolt and Rivet', null],
    ]);
    const { rows: deps } = await t.db.query<{ deps_method: string | null }>(
      'SELECT deps_method FROM run_worktrees WHERE orchestration_run_id = $1',
      [runId],
    );
    expect(deps.map((row) => row.deps_method)).toEqual([null, null]);

    expect(await readFile(join(root, 'src/dates.ts'), 'utf8')).toBe('step 1\n');
    expect(await readFile(join(root, 'src/divider.tsx'), 'utf8')).toBe('step 2\n');
    expect(await readFile(join(root, 'src/turns.ts'), 'utf8')).toBe('step 3\n');
    const { rows: decisions } = await t.db.query<{ summary: string }>(
      `SELECT body->>'summary' AS summary FROM run_advice WHERE run_id = $1 AND purpose = 'parallel'`,
      [runId],
    );
    expect(decisions[0]?.summary).toContain('Chains in parallel: steps 1 and 2 | step 3');
    expect(decisions[0]?.summary).toContain(
      'Chains: split (decided by rule; Jev did not answer on one Builder; rule: split) · worktrees (need: requested, worktrees were requested;',
    );
  }, 60_000);

  it('keeps a Critic when Jev reads the request as a review, even at execute depth', async () => {
    const scenario: Scenario = { ...TRIVIAL, intent: 'review' };
    start(scenario);
    const { conversationId, runId } = await startScenario(t, root, scenario, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.depth).toBe('execute');
    const rows = await children(runId);
    expect(rows.map((row) => row.role)).toEqual(['critic']);
    const { rows: advice } = await t.db.query<{ reason: string }>(
      `SELECT body->'depthNote'->>'reason' AS reason FROM run_advice
       WHERE run_id = $1 AND purpose = 'intake'`,
      [runId],
    );
    expect(advice[0]?.reason).toBe(REVIEW_INTENT_REASON);
  });

  it('keeps a Critic for a review request Jev is unsure about, and prices the Codex review', async () => {
    const scenario: Scenario = {
      ...TRIVIAL,
      text: 'Review my changes to the README heading.',
      intent: 'review',
      intentConfidence: 0.44,
      reviewExisting: 0.6,
    };
    start(scenario);
    const { conversationId, runId } = await startScenario(t, root, scenario, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    const { rows } = await t.db.query<{
      role: string;
      provider: string;
      input_tokens: number;
      cached_read_tokens: number;
      cost_usd: string;
      cost_source: string;
    }>(
      `SELECT role, provider, input_tokens, cached_read_tokens, cost_usd, cost_source
       FROM runs WHERE parent_run_id = $1`,
      [runId],
    );
    expect(rows).toEqual([
      {
        role: 'critic',
        provider: 'codex',
        input_tokens: 220,
        cached_read_tokens: 100,
        cost_usd: '0.000860',
        cost_source: 'estimated',
      },
    ]);
  });
});
