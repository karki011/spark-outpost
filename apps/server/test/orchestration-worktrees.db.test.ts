import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type CheckBody } from '@spark-outpost/contracts';
import { requestCancel } from '../src/persistence/runs.ts';
import {
  RISKY,
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
  type Answerer,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const NEEDS_DEPS = `import { existsSync } from 'node:fs';
if (!existsSync('node_modules/left-pad/index.js')) {
  console.error('node_modules is missing');
  process.exit(1);
}
`;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
  const script: JevScript = { calls: [] };
  harness = startOrchestrator(t, jevFetch(script));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function run(tags: string, answer?: Answerer) {
  const scenario = withTag(RISKY, tags);
  const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
  const result = await driveToEnd(t, conversationId, runId, answer);
  return { ...result, runId };
}

async function expectNoCopies(runId: string) {
  const listed = git('worktree', 'list', '--porcelain');
  expect(listed).not.toContain('.spark');
  expect(git('branch', '--list', 'spark/*').trim()).toBe('');
  const left = await readdir(join(root, '.spark', 'worktrees')).catch(() => []);
  expect(left).toEqual([]);
  const { rows } = await t.db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM run_worktrees
     WHERE orchestration_run_id = $1 AND removed_at IS NULL`,
    [runId],
  );
  expect(Number(rows[0]!.count)).toBe(0);
}

describe('the solo worktree copy', () => {
  it('builds destructive work in one copy, retries in the same copy, merges and removes it', async () => {
    const { orchestration, runId } = await run('#failonce 1');
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.crew.map((member) => [member.role, member.copy])).toEqual([
      ['builder', expect.stringMatching(/^spark\//)],
      ['builder', expect.stringMatching(/^spark\//)],
      ['critic', null],
    ]);
    const { rows } = await t.db.query<{ removed: boolean; merged: boolean }>(
      `SELECT removed_at IS NOT NULL AS removed, merged_at IS NOT NULL AS merged
       FROM run_worktrees WHERE orchestration_run_id = $1`,
      [runId],
    );
    expect(rows).toEqual([{ removed: true, merged: true }]);
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\nstep 1\n');
    await expectNoCopies(runId);
  }, 60_000);

  it('asks which version to keep when your files changed meanwhile, with no reconcile', async () => {
    const answer: Answerer = (approval) =>
      approval.kind === 'merge_conflict'
        ? { optionId: CHECKPOINT_OPTION.keepSecond }
        : answerEverything(approval);
    const { asked, runId } = await run('#touchmain', answer);
    const conflict = asked.find((approval) => approval.kind === 'merge_conflict');
    expect(conflict?.options.map((option) => option.optionId)).toEqual([
      CHECKPOINT_OPTION.keepFirst,
      CHECKPOINT_OPTION.keepSecond,
      CHECKPOINT_OPTION.stop,
    ]);
    expect(conflict?.payload.checkpoint?.conflict?.first).toBe('your version');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\nstep 1\n');
    await expectNoCopies(runId);
  }, 60_000);

  it('gives a second task in the same repo its own copy while the first still works', async () => {
    const slow = withTag(TRIVIAL, '#slowbuild');
    const first = await startScenario(t, root, slow, 'hands-off');
    await eventually(async () => {
      const { rows } = await t.db.query(
        `SELECT 1 FROM runs WHERE parent_run_id = $1 AND status = 'running'`,
        [first.runId],
      );
      return rows.length > 0 ? true : null;
    }, 30_000);
    const second = await startScenario(t, root, TRIVIAL, 'hands-off');
    const { orchestration } = await driveToEnd(t, second.conversationId, second.runId);
    expect(orchestration.crew[0]?.copy).toMatch(/^spark\//);
    await requestCancel(t.db, first.runId);
    await driveToEnd(t, first.conversationId, first.runId);
    await expectNoCopies(second.runId);
  }, 60_000);

  it('prepares node_modules beside the Builder, makes checks wait for it, and removes it', async () => {
    await writeFile(join(root, '.gitignore'), 'node_modules\n');
    await writeFile(join(root, 'package.json'), '{"name":"app","private":true}\n');
    await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
    await writeFile(join(root, 'check.mjs'), NEEDS_DEPS);
    git('add', '.');
    git('commit', '-qm', 'node project');
    await setCheckCommands(t, root, ['node check.mjs']);

    const { orchestration, runId } = await run('');
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ deps_method: string; deps_waited_ms: number | null }>(
      'SELECT deps_method, deps_waited_ms FROM run_worktrees WHERE orchestration_run_id = $1',
      [runId],
    );
    expect(rows.map((row) => row.deps_method)).toEqual(['clone']);
    expect(rows.every((row) => row.deps_waited_ms !== null)).toBe(true);
    const checks = await artifactBodies<CheckBody>(t, 'check');
    expect(checks.map((body) => [body.copy, body.status])).toEqual([['Bolt', 'passed']]);
    expect(existsSync(join(root, 'node_modules', 'left-pad', 'index.js'))).toBe(true);
    await expectNoCopies(runId);
  }, 60_000);
});
