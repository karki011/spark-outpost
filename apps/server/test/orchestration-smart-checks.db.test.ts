import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckBody } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { rememberDeps } from '../src/projects/deps-install.ts';
import {
  OLD_TEST_FAILURE,
  OLD_TYPE_ERROR,
  TESTS_FAIL_AFTER_CHANGE,
  WHOLE_REPO_IS_SLOW,
  nxWorkspace,
  type CheckFixture,
} from './check-fixture.ts';
import {
  TRIVIAL,
  artifactBodies,
  connectProviders,
  driveToEnd,
  jevFetch,
  setCheckCommands,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const SCOPED = '(whole-repo run skipped)';
const STILL_RED = TESTS_FAIL_AFTER_CHANGE.replace(
  " && !existsSync(path.join(cwd, 'fixed.txt'))",
  '',
);

let t: TestDb;
let fixture: CheckFixture;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await fixture.remove();
  rmSync(store, { recursive: true, force: true });
});

async function run(
  tools: Record<string, string>,
  prepare?: () => Promise<void>,
  level: 'full-auto' | 'hands-off' = 'full-auto',
) {
  fixture = await nxWorkspace(tools);
  await prepare?.();
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: TRIVIAL }), { sessions: store });
  const { conversationId, runId } = await startScenario(t, fixture.root, TRIVIAL, level);
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  const bodies = await artifactBodies<CheckBody>(t, 'check');
  const { rows } = await t.db.query<{ role: string; follow_up: string | null }>(
    `SELECT role, route->>'followUp' AS follow_up FROM runs
     WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  const detail = await getConversationDetail(t.db, conversationId);
  const items = detail?.tasks.flatMap((task) => task.items) ?? [];
  const checkRows = items.filter((item) => item.label.startsWith('Checks for'));
  return { orchestration, bodies, members: rows, checkRows, runId };
}

async function auditOf(runId: string, method: string) {
  const { rows } = await t.db.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = $2 ORDER BY seq`,
    [runId, method],
  );
  return rows.map((row) => row.payload);
}

describe('checks judge the change in a large workspace', { timeout: 120_000 }, () => {
  it('reports a failure that is also on the base once, calmly, and does not send the Builder back', async () => {
    const { orchestration, bodies, members, checkRows, runId } = await run({
      'typecheck.mjs': OLD_TYPE_ERROR,
      'test.mjs': WHOLE_REPO_IS_SLOW,
    });
    expect(orchestration.status).toBe('succeeded');
    expect(members.map((member) => member.role)).toEqual(['builder']);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.status).toBe('passed');
    expect(bodies[0]!.results.map((result) => [result.command, result.cause ?? null])).toEqual([
      ['pnpm exec nx affected -t typecheck --files=notes.txt', 'baseline'],
      ['pnpm exec nx affected -t lint --files=notes.txt', null],
      ['pnpm exec nx affected -t test --files=notes.txt', null],
    ]);
    expect(bodies[0]!.results[0]!.baseline).toMatchObject({
      outcome: 'failed',
      cached: false,
      added: [],
      shared: ['task design-system-mcp:build', 'type libs/legacy/src/old.ts TS2322'],
    });
    expect(checkRows.map((row) => [row.label, row.state])).toEqual([
      [
        `Checks for Bolt's copy: typecheck already failing before this change · lint for affected projects passed ${SCOPED} · tests for affected projects passed ${SCOPED}`,
        'done',
      ],
    ]);
    expect(checkRows[0]!.output).toContain('also fails before this change');
    expect(checkRows[0]!.output).toContain('instead of `pnpm run test`');
    const audit = await auditOf(runId, 'check/run');
    expect(audit.map((entry) => entry.cause)).toEqual(['baseline', null, null]);
    expect(audit[0]!.baseline).toMatchObject({ outcome: 'failed' });
  });

  it('replays the reported first session: old type errors and an old failing test cost no Builder time', async () => {
    const { orchestration, bodies, members, checkRows } = await run({
      'typecheck.mjs': OLD_TYPE_ERROR,
      'test.mjs': OLD_TEST_FAILURE,
    });
    expect(orchestration.status).toBe('succeeded');
    expect(members.map((member) => member.role)).toEqual(['builder']);
    expect(bodies.map((body) => body.status)).toEqual(['passed']);
    expect(checkRows.map((row) => [row.label, row.state])).toEqual([
      [
        `Checks for Bolt's copy: typecheck already failing before this change · lint for affected projects passed ${SCOPED} · tests already failing before this change`,
        'done',
      ],
    ]);
  });

  it('gives a failure the change caused exactly one Builder round, then stops', async () => {
    const { orchestration, bodies, members } = await run({ 'test.mjs': STILL_RED });
    expect(orchestration.status).toBe('succeeded');
    expect(members.map((member) => member.role)).toEqual(['builder', 'builder']);
    expect(bodies.map((body) => body.status)).toEqual(['failed', 'failed']);
    const tests = bodies[0]!.results.find((result) => result.kind === 'test')!;
    expect(tests).toMatchObject({
      cause: 'change',
      baseline: {
        outcome: 'failed',
        shared: ['test libs/dashboards/api/src/dashboards-api.test.ts'],
        added: ['test libs/a/src/a.test.ts'],
      },
    });
    expect(members[1]!.follow_up).toContain('## Failing checks');
    expect(members[1]!.follow_up).toContain(
      'leave them alone: test libs/dashboards/api/src/dashboards-api.test.ts.',
    );
    expect(members[1]!.follow_up).toContain(
      'Spark ties these to your change: test libs/a/src/a.test.ts.',
    );
    expect(bodies[1]!.results.find((result) => result.kind === 'test')!.cause).toBe('change');
    expect(bodies.map((body) => body.leftForUser ?? false)).toEqual([false, true]);
  });

  it('falls back to the project’s own script when the narrowed form is not usable', async () => {
    const { bodies } = await run({ 'no-affected': '' });
    expect(bodies[0]!.results.map((result) => [result.command, result.outcome])).toEqual([
      ['pnpm run typecheck', 'passed'],
      ['pnpm run lint', 'passed'],
      ['pnpm run test', 'passed'],
    ]);
    expect(bodies[0]!.results.every((result) => !result.scope)).toBe(true);
  });

  it('runs exactly the commands the project sets, without narrowing them', async () => {
    const { bodies } = await run({ 'own.mjs': "console.log('mine');\n" }, () =>
      setCheckCommands(t, fixture.root, ['node tools/own.mjs']),
    );
    expect(bodies[0]!.results).toMatchObject([
      { command: 'node tools/own.mjs', outcome: 'passed' },
    ]);
    expect(bodies[0]!.results[0]!.scope).toBeUndefined();
  });

  it('installs first when the lockfile changed since dependencies were prepared', async () => {
    const { bodies, runId } = await run(
      {},
      async () =>
        rememberDeps(fixture.root, 'the lockfile the dependencies were installed for', null),
      'hands-off',
    );
    const mine = (await fixture.installs()).filter((line) =>
      line.startsWith(basename(fixture.root)),
    );
    expect(mine).toEqual([
      `${basename(fixture.root)} --frozen-lockfile --prefer-offline --ignore-scripts`,
    ]);
    expect(bodies[0]!.status).toBe('passed');
    expect(await auditOf(runId, 'deps/install')).toMatchObject([
      { outcome: 'installed', lockfileMatched: false },
    ]);
  });

  it('reports dependencies out of date instead of test failures when that install fails', async () => {
    const { orchestration, bodies, members, checkRows } = await run(
      { 'install-fails': '', 'test.mjs': STILL_RED },
      async () => rememberDeps(fixture.root, 'an older lockfile', null),
      'hands-off',
    );
    expect(orchestration.status).toBe('succeeded');
    expect(members.map((member) => member.role)).toEqual(['builder']);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.status).toBe('skipped');
    expect(bodies[0]!.results.map((result) => result.cause)).toEqual([
      'environment',
      'environment',
      'environment',
    ]);
    expect(bodies[0]!.results[0]!.note).toContain(
      'installing them failed: your package registry login is missing or has expired; run `npm login`',
    );
    expect(checkRows[0]!.state).toBe('done');
    expect(checkRows[0]!.label).toContain('tests could not run');
  });
});
