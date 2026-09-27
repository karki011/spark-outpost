import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECKPOINT_OPTION,
  type Approval,
  type CheckpointPayload,
  type PlanVersion,
} from '@spark-outpost/contracts';
import { planVersions } from '../src/persistence/artifacts.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import { taskChanges } from '../src/projects/task-changes.ts';
import {
  SCENARIOS,
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  planWrites,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const COMPLEX = SCENARIOS[3] as Scenario;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
  const script: JevScript = { calls: [], scenario: COMPLEX };
  harness = startOrchestrator(t, jevFetch(script));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function start(tags: string, level: 'hands-off' | 'balanced' = 'hands-off') {
  const scenario = { ...COMPLEX, text: `${COMPLEX.text} ${tags}` };
  return startScenario(t, root, scenario, level);
}

async function run(
  tags: string,
  answer: Answerer = answerEverything,
  level: 'hands-off' | 'balanced' = 'hands-off',
) {
  const { conversationId, runId } = await start(tags, level);
  const result = await driveToEnd(t, conversationId, runId, answer);
  return { ...result, runId };
}

const statuses = (versions: readonly PlanVersion[]) =>
  versions.map((version) => version.body.entries.map((entry) => entry.status).join(' '));

const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

function worktreesLeft(): string[] {
  return git('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree ') && line.includes('.spark'));
}

function sparkBranches(): string {
  return git('branch', '--list', 'spark/*').trim();
}

async function liveRows(runId: string): Promise<number> {
  const { rows } = await t.db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM run_worktrees
     WHERE orchestration_run_id = $1 AND removed_at IS NULL`,
    [runId],
  );
  return Number(rows[0]!.count);
}

function expectClean(runId: string) {
  expect(worktreesLeft()).toEqual([]);
  expect(sparkBranches()).toBe('');
  return expect(liveRows(runId)).resolves.toBe(0);
}

const choose =
  (optionId: string): Answerer =>
  (approval) =>
    approval.kind === 'merge_conflict' ? { optionId } : answerEverything(approval);

function conflictOf(asked: readonly Approval[]): CheckpointPayload | undefined {
  return asked.find((approval) => approval.kind === 'merge_conflict')?.payload.checkpoint;
}

describe('parallel Builders', () => {
  it('runs independent steps in their own copies and merges both back cleanly', async () => {
    const { orchestration, asked, runId } = await run('#parallel', answerEverything, 'balanced');
    expect(orchestration.status).toBe('succeeded');
    const workers = orchestration.crew.filter((member) => member.role !== 'critic');
    expect(workers.map((member) => member.name)).toEqual(['Sketch', 'Bolt', 'Rivet', 'Tack']);
    const reviews = orchestration.crew.filter((member) => member.role === 'critic');
    expect(reviews.map((member) => member.name)).toEqual(['Hawk', 'Hawk']);
    const { rows: prompts } = await t.db.query<{ prompt: string }>(
      `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'critic' ORDER BY created_at`,
      [runId],
    );
    expect(prompts.at(-1)?.prompt).toContain("Rivet and Tack's change for steps 2, 3.");
    const [rivet, tack] = workers.slice(2, 4);
    expect(rivet?.parallelGroup).toBe('g1');
    expect(tack?.parallelGroup).toBe('g1');
    expect(rivet?.copy).toMatch(/^spark\/[0-9a-f]{8}\/rivet$/);
    expect(workers[1]?.parallelGroup).toBeNull();

    expect(await readFile(join(root, 'src/dates.ts'), 'utf8')).toBe('step 1\n');
    expect(await readFile(join(root, 'src/divider.tsx'), 'utf8')).toBe('step 2\n');
    expect(await readFile(join(root, 'src/turns.ts'), 'utf8')).toBe('step 3\n');

    const copyEdits = asked.filter((approval) => approval.title.includes("'s copy"));
    expect(copyEdits.map((approval) => approval.title).sort()).toEqual([
      "Write src/divider.tsx · Rivet's copy",
      "Write src/turns.ts · Tack's copy",
    ]);
    expect(copyEdits[0]?.payload.paths[0]).toMatch(/^src\//);

    const versions = await planVersions(t.db, orchestration.taskId!);
    expect(await planWrites(t, runId)).toContain('completed in_progress in_progress');
    expect(statuses(versions)).toEqual(['completed completed completed']);
    expect(git('status', '--porcelain')).not.toContain('.spark');
    expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toContain('.spark/');
    await expectClean(runId);

    const changes = await taskChanges(t.db, t.workspaceId, orchestration.taskId!);
    const rivetChanges = changes.runs.find((entry) => entry.runId === rivet?.runId);
    expect(rivetChanges?.name).toBe('Rivet');
    expect(rivetChanges?.copy).toBe(rivet?.copy);
    expect(rivetChanges?.files.map((file) => file.path)).toEqual(['src/divider.tsx']);
  }, 60_000);

  it('takes the parallel steps from the Architect’s Parallel line', async () => {
    const { orchestration, runId } = await run('#parallel #parallelline');
    expect(orchestration.status).toBe('succeeded');
    const grouped = orchestration.crew.filter((member) => member.parallelGroup === 'g1');
    expect(grouped.map((member) => member.name)).toEqual(['Rivet', 'Tack']);
    expect(await readFile(join(root, 'src/turns.ts'), 'utf8')).toBe('step 3\n');
    await expectClean(runId);
  }, 60_000);

  it('runs research steps as parallel Scouts and hands their notes to the Builder', async () => {
    const { orchestration } = await run('#research');
    expect(orchestration.status).toBe('succeeded');
    const scouts = orchestration.crew.filter((member) => member.role === 'scout');
    expect(scouts.map((member) => member.name)).toEqual(['Pip', 'Wren']);
    expect(scouts.every((member) => member.parallelGroup === 'g1' && !member.copy)).toBe(true);
    expect(scouts.every((member) => member.mode === 'ask')).toBe(true);
    const { rows } = await t.db.query<{ prompt: string }>(
      `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'builder'`,
      [orchestration.runId],
    );
    expect(rows[0]?.prompt).toContain('## Notes from Scouts');
    expect(rows[0]?.prompt).toContain('Found: Research: how src/dates.ts is used');
  }, 60_000);
});

describe('merge conflicts', () => {
  it('asks which change to keep and keeps the first Builder’s', async () => {
    const { orchestration, asked, runId } = await run(
      '#parallel #collide',
      choose(CHECKPOINT_OPTION.keepFirst),
    );
    const conflict = conflictOf(asked);
    expect(conflict?.reason).toBe('Rivet and Tack both changed notes.txt.');
    expect(conflict?.conflict?.files[0]?.first.diff).toContain('+step 2');
    expect(conflict?.conflict?.files[0]?.second.diff).toContain('+step 3');
    expect(orchestration.status).toBe('succeeded');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\nstep 1\nstep 2\n');
    await expectClean(runId);
  }, 60_000);

  it('keeps the second Builder’s change when asked', async () => {
    const { orchestration, runId } = await run(
      '#parallel #collide',
      choose(CHECKPOINT_OPTION.keepSecond),
    );
    expect(orchestration.status).toBe('succeeded');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\nstep 1\nstep 3\n');
    await expectClean(runId);
  }, 60_000);

  it('asks a Builder to reconcile both changes in the main copy', async () => {
    const { orchestration, asked, runId } = await run(
      '#parallel #collide',
      choose(CHECKPOINT_OPTION.reconcile),
    );
    expect(orchestration.status).toBe('succeeded');
    const workers = orchestration.crew.filter((member) => member.role !== 'critic');
    expect(workers.map((member) => member.name)).toEqual([
      'Sketch',
      'Bolt',
      'Rivet',
      'Tack',
      'Chip',
    ]);
    const chip = workers[4]!;
    expect(chip.copy ?? null).toBeNull();
    expect(chip.parallelGroup ?? null).toBeNull();
    expect(chip.mode).toBe('do');
    expect(conflictOf(asked)?.conflict?.second).toBe('Tack');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe(
      'start\nstep 1\nstep 2\nreconciled\n',
    );
    const versions = await planVersions(t.db, orchestration.taskId!);
    expect(statuses(versions).at(-1)).toBe('completed completed completed');
    await expectClean(runId);
  }, 60_000);

  it('stops the orchestration and cleans up when you choose Stop', async () => {
    const { orchestration, runId } = await run(
      '#parallel #collide',
      choose(CHECKPOINT_OPTION.stop),
    );
    expect(orchestration.status).toBe('cancelled');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\nstep 1\nstep 2\n');
    await expectClean(runId);
  }, 60_000);
});

describe('stopping and recovery', () => {
  it('cleans up every copy when you stop during a parallel group', async () => {
    const { conversationId, runId } = await start('#parallel #slowstep 3');
    await eventually(async () => ((await liveRows(runId)) === 2 ? true : null), 30_000);
    await eventually(async () => {
      const { rows } = await t.db.query<{ status: string }>(
        `SELECT status FROM runs WHERE parent_run_id = $1 AND step_index = 1 AND role = 'builder'`,
        [runId],
      );
      return rows[0]?.status === 'succeeded' ? true : null;
    }, 30_000);
    await requestCancel(t.db, runId);
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('cancelled');
    expect(existsSync(join(root, 'src/divider.tsx'))).toBe(false);
    await expectClean(runId);
  }, 60_000);

  it('removes copies left behind by a crashed orchestration', async () => {
    await harness?.stop();
    harness = null;
    const { runId } = await start('#parallel');
    await t.db.query(
      `UPDATE jobs SET status = 'leased', lease_token = gen_random_uuid(),
         lease_expires_at = now() - interval '1 minute' WHERE run_id = $1`,
      [runId],
    );
    const base = git('rev-parse', 'HEAD').trim();
    const target = join(root, '.spark/worktrees', runId);
    git('worktree', 'add', '-q', '-B', 'spark/crashed/bolt', target, base);
    await t.db.query(
      `INSERT INTO run_worktrees (run_id, orchestration_run_id, repo_root, path, branch,
         base_commit)
       VALUES ($1, $1, $2, $3, 'spark/crashed/bolt', $4)`,
      [runId, root, target, base],
    );
    harness = startOrchestrator(t, null);
    await eventually(async () => ((await liveRows(runId)) === 0 ? true : null), 30_000);
    const { rows } = await t.db.query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [
      runId,
    ]);
    expect(rows[0]?.status).toBe('outcome_unknown');
    expect(existsSync(target)).toBe(false);
    expect(worktreesLeft()).toEqual([]);
    expect(sparkBranches()).toBe('');
  }, 60_000);
});

describe('projects outside git', () => {
  it('gives the parallel steps to one Builder and records why', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'spark-plain-')));
    await writeFile(join(plain, 'notes.txt'), 'start\n');
    try {
      const scenario = { ...COMPLEX, text: `${COMPLEX.text} #parallel` };
      const { conversationId, runId } = await startScenario(t, plain, scenario, 'hands-off');
      const { orchestration } = await driveToEnd(t, conversationId, runId);
      expect(orchestration.status).toBe('succeeded');
      expect(orchestration.parallelNote).toMatch(/not a git repository/);
      const builders = orchestration.crew.filter((member) => member.role === 'builder');
      expect(builders.map((member) => member.parallelGroup ?? null)).toEqual([null]);
      expect(await readFile(join(plain, 'src/turns.ts'), 'utf8')).toBe('step 3\n');
      const versions = await planVersions(t.db, orchestration.taskId!);
      expect(statuses(versions).at(-1)).toBe('completed completed completed');
    } finally {
      await removeRepo(plain);
    }
  }, 60_000);
});
