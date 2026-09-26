import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckBody } from '@spark-outpost/contracts';
import { createProject } from '../src/projects/projects.ts';
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
  const script: JevScript = { calls: [], scenario: COMPLEX };
  harness = startOrchestrator(t, jevFetch(script), { lanes: { placement: 'worktree' } });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function run(tags: string) {
  const scenario = { ...COMPLEX, text: `${COMPLEX.text} ${tags}` };
  const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
  const result = await driveToEnd(t, conversationId, runId);
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

describe('worktree lifecycle', () => {
  it('removes a failed member’s copy and branch before its step is retried', async () => {
    const { orchestration, runId } = await run('#parallel #failonce 2');
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ removed: boolean; merged: boolean }>(
      `SELECT removed_at IS NOT NULL AS removed, merged_at IS NOT NULL AS merged
       FROM run_worktrees WHERE orchestration_run_id = $1 ORDER BY created_at`,
      [runId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.removed)).toBe(true);
    expect(rows.some((row) => !row.merged)).toBe(true);
    const { rows: reviews } = await t.db.query<{ prompt: string }>(
      `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'critic' ORDER BY created_at`,
      [runId],
    );
    expect(reviews.some((review) => review.prompt.includes("Tack's change for step 3."))).toBe(
      true,
    );
    await expectNoCopies(runId);
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
    const { project } = await createProject(t.db, t.workspaceId, root);
    await t.db.query('UPDATE projects SET check_commands = $2 WHERE id = $1', [
      project.id,
      ['node check.mjs'],
    ]);

    const { orchestration, runId } = await run('#parallel');
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ deps_method: string; deps_waited_ms: number | null }>(
      'SELECT deps_method, deps_waited_ms FROM run_worktrees WHERE orchestration_run_id = $1',
      [runId],
    );
    expect(rows.map((row) => row.deps_method)).toEqual(['clone', 'clone']);
    expect(rows.every((row) => row.deps_waited_ms !== null)).toBe(true);
    const { rows: checks } = await t.db.query<{ body: CheckBody }>(
      `SELECT body FROM run_artifacts WHERE kind = 'check' ORDER BY version`,
    );
    expect(checks.map((row) => [row.body.copy, row.body.status])).toContainEqual([
      'Rivet',
      'passed',
    ]);
    expect(checks.every((row) => row.body.status === 'passed')).toBe(true);
    expect(existsSync(join(root, 'node_modules', 'left-pad', 'index.js'))).toBe(true);
    await expectNoCopies(runId);
  }, 60_000);
});
