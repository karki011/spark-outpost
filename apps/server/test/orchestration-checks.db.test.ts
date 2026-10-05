import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckBody } from '@spark-outpost/contracts';
import { allowedForRun } from '../src/persistence/approvals.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import {
  TRIVIAL,
  answerEverything,
  artifactBodies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  setCheckCommands,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const FAILS_UNTIL_FIXED = `import { existsSync, readFileSync } from 'node:fs';
if (readFileSync('notes.txt', 'utf8').includes('step') && !existsSync('fixed.txt')) {
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

function start(scenario: Scenario) {
  const script: JevScript = { calls: [], scenario };
  harness = startOrchestrator(t, jevFetch(script), { sessions: store });
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

const checkBodies = () => artifactBodies<CheckBody>(t, 'check');

async function fixRunId(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>(
    `SELECT id FROM runs WHERE parent_run_id = $1 AND role = 'builder' ORDER BY created_at`,
    [runId],
  );
  return rows.at(-1)!.id;
}

async function lastReply(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ text: string }>(
    `SELECT string_agg(payload->>'delta', '' ORDER BY seq) AS text FROM run_events
     WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'`,
    [runId],
  );
  return rows[0]?.text ?? '';
}

describe('checks after a Builder lands', { timeout: 60_000 }, () => {
  it('runs the project checks, resumes the Builder to fix a failure, and records it all', async () => {
    await writeFile(join(root, 'check.mjs'), FAILS_UNTIL_FIXED);
    await setCheckCommands(t, root, ['node check.mjs']);
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

    const [first, fix] = await children(runId);
    expect(first?.route.resumeKey).toBe(`${first?.task_id}:builder`);
    expect(fix?.role).toBe('builder');
    expect(fix?.route.name).toBe('Bolt');
    expect(fix?.route.resumeKey).toBe(`${fix?.task_id}:builder`);
    expect(fix?.route.followUp).toContain('## Failing checks');
    expect(fix?.route.followUp).toContain('expected fixed.txt to exist');
    expect(await readFile(join(root, 'fixed.txt'), 'utf8')).toBe('fixed\n');

    expect(await lastReply(await fixRunId(runId))).toContain('after 1 earlier prompts');

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
    expect(labels).toContain("Checks for Bolt's copy: node check.mjs failed");
    expect(labels).toContain("Checks for Bolt's copy: node check.mjs passed");
    const failed = detail?.tasks[0]?.items.find((item) => item.label.endsWith('failed'));
    expect(failed?.state).toBe('failed');
    expect(failed?.output).toContain('expected fixed.txt to exist');
    expect(failed?.output).toContain('passes before this change');
    expect(bodies[0]!.results[0]).toMatchObject({
      cause: 'change',
      baseline: { outcome: 'passed', cached: false },
    });

    const { rows: sessions } = await t.db.query<{ close_reason: string | null }>(
      `SELECT close_reason FROM provider_sessions WHERE agent_key LIKE 'key:%'`,
    );
    expect(sessions.map((row) => row.close_reason)).toEqual([null]);
  });

  it('asks before running a check at Balanced and reports a pass', async () => {
    await writeFile(join(root, 'check.mjs'), "console.log('ok');\n");
    await setCheckCommands(t, root, ['node check.mjs']);
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, null);
    const { asked } = await driveToEnd(t, conversationId, runId);
    expect(asked.map((approval) => approval.title)).toContain('Run check: node check.mjs');
    const bodies = await checkBodies();
    expect(bodies.map((body) => body.status)).toEqual(['passed']);
    expect((await children(runId)).map((row) => row.role)).toEqual(['builder']);
  });

  it('lets "Allow for this run" on a Builder edit cover the same Builder fixing its checks', async () => {
    await writeFile(join(root, 'check.mjs'), FAILS_UNTIL_FIXED);
    await setCheckCommands(t, root, ['node check.mjs']);
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, null);
    const { asked } = await driveToEnd(t, conversationId, runId, (approval) => {
      const decision = answerEverything(approval);
      return decision && approval.kind === 'edit' ? { ...decision, scope: 'run' } : decision;
    });
    expect(asked.filter((approval) => approval.kind === 'edit')).toHaveLength(1);
    const [, fix] = await children(runId);
    expect(fix?.route.resumeKey).toBeDefined();
    const { rows } = await t.db.query<{ decided_by: string }>(
      `SELECT a.decided_by FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.kind = 'edit'`,
      [runId],
    );
    expect(rows.map((row) => row.decided_by)).toEqual(['user', 'run_rule']);
    expect(await readFile(join(root, 'fixed.txt'), 'utf8')).toBe('fixed\n');

    const fixId = await fixRunId(runId);
    expect(await allowedForRun(t.db, fixId)).toHaveLength(1);
    await t.db.query(
      `UPDATE runs SET route = route || '{"name":"Rivet","resumeKey":"other:builder"}' WHERE id = $1`,
      [fixId],
    );
    expect(await allowedForRun(t.db, fixId)).toEqual([]);
  });

  it('runs no checks when the project turns them off', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'exit 1' } }));
    await setCheckCommands(t, root, []);
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    expect(await checkBodies()).toEqual([]);
  });
});

describe('when a Critic runs', { timeout: 60_000 }, () => {
  it('reviews a large diff once on the other provider, even for ordinary work', async () => {
    const big = withTag(TRIVIAL, '#bigdiff');
    start(big);
    const { conversationId, runId } = await startScenario(t, root, big, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.crew.map((member) => [member.role, member.provider])).toEqual([
      ['builder', 'claude'],
      ['critic', 'codex'],
    ]);
  });

  it('skips the Critic for a small ordinary change', async () => {
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder']);
  });

  it('keeps a Critic when Jev reads the request as a review', async () => {
    const scenario: Scenario = { ...TRIVIAL, review: 0.95 };
    start(scenario);
    const { conversationId, runId } = await startScenario(t, root, scenario, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.depth).toBe('execute');
    const rows = await children(runId);
    expect(rows.map((row) => row.role)).toEqual(['builder', 'critic']);
    const intake = orchestration.decisions.find((decision) => decision.kind === 'intake');
    expect(intake?.summary).toContain('review wanted (jev 0.95)');
  });

  it('keeps a Critic for a review request Jev is unsure about, and prices the Codex review', async () => {
    const scenario: Scenario = {
      ...TRIVIAL,
      text: 'Review my changes to the README heading.',
      intent: 'review',
      intentConfidence: 0.44,
      review: 0.6,
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
       FROM runs WHERE parent_run_id = $1 AND role = 'critic'`,
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
