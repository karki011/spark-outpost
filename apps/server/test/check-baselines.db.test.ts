import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Baselines } from '../src/checks/baseline.ts';
import { configuredChecks } from '../src/checks/detect.ts';
import { gitRepo, removeRepo } from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let outside: string;
let counter: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args])
    .toString()
    .trim();

const [check] = configuredChecks(['node check.mjs']);

function commitCheck(body: string): string {
  writeFileSync(
    join(root, 'check.mjs'),
    `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(counter)}, 'run\\n');\n${body}\n`,
  );
  git('add', '.');
  git('commit', '-qm', 'check');
  return git('rev-parse', 'HEAD');
}

const baseRuns = () => readFileSync(counter, 'utf8').split('\n').filter(Boolean).length;

function baselines(base: string, signal = new AbortController().signal) {
  return new Baselines({ db: t.db, cwd: root, base, signal, limitMs: 30_000 });
}

const failed = { check: check!, durationMs: 100 };

async function ageSaved(minutes: number): Promise<void> {
  await t.db.query(`UPDATE check_baselines SET created_at = now() - make_interval(mins => $1)`, [
    minutes,
  ]);
}

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  outside = mkdtempSync(join(tmpdir(), 'spark-baseline-test-'));
  counter = join(outside, 'runs');
  writeFileSync(counter, '');
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
  rmSync(outside, { recursive: true, force: true });
});

describe('the baseline of a failing check', { timeout: 60_000 }, () => {
  it('runs the command on the base commit and answers from memory only while that is fresh', async () => {
    const base = commitCheck("console.log(' FAIL  src/old.test.ts > x'); process.exit(1);");
    const first = baselines(base);
    expect(await first.evidence(failed)).toMatchObject({
      outcome: 'failed',
      trusted: true,
      cached: false,
      failures: ['test src/old.test.ts'],
    });
    await first.dispose();
    expect(baseRuns()).toBe(1);

    const second = baselines(base);
    expect(await second.evidence(failed)).toMatchObject({ cached: true, trusted: true });
    await second.dispose();
    expect(baseRuns()).toBe(1);

    await ageSaved(61);
    const later = baselines(base);
    expect(await later.evidence(failed)).toMatchObject({ cached: false, trusted: true });
    await later.dispose();
    expect(baseRuns()).toBe(2);

    const moved = commitCheck("console.log('fine');");
    const third = baselines(moved);
    expect(await third.evidence(failed)).toMatchObject({
      outcome: 'passed',
      cached: false,
      trusted: true,
    });
    await third.dispose();
    expect(baseRuns()).toBe(3);
  });

  it('does not reuse a result from another environment', async () => {
    const base = commitCheck("process.exit(process.env.SPARK_FIXTURE_MODE === 'red' ? 1 : 0);");
    const green = baselines(base);
    expect(await green.evidence(failed)).toMatchObject({ outcome: 'passed', cached: false });
    await green.dispose();
    const signal = new AbortController().signal;
    const red = new Baselines({
      db: t.db,
      cwd: root,
      base,
      signal,
      limitMs: 30_000,
      env: { SPARK_FIXTURE_MODE: 'red' },
    });
    expect(await red.evidence(failed)).toMatchObject({ outcome: 'failed', cached: false });
    await red.dispose();
    expect(baseRuns()).toBe(2);
  });

  it('does not trust or remember a pass that a task runner replayed from its cache', async () => {
    const base = commitCheck(
      "console.log('Nx read the output from the cache instead of running the command for 2 out of 2 tasks.');",
    );
    const runner = baselines(base);
    expect(await runner.evidence(failed)).toMatchObject({ outcome: 'passed', trusted: false });
    await runner.dispose();
    const { rows } = await t.db.query('SELECT 1 FROM check_baselines');
    expect(rows).toEqual([]);
  });

  it('asks task runners for a real run on the base commit', async () => {
    const base = commitCheck(
      "process.exit(process.env.NX_SKIP_NX_CACHE === 'true' && process.env.TURBO_FORCE === 'true' ? 0 : 1);",
    );
    const runner = baselines(base);
    expect(await runner.evidence(failed)).toMatchObject({ outcome: 'passed', trusted: true });
    await runner.dispose();
  });

  it('never trusts a baseline that ran out of time', async () => {
    const base = commitCheck('await new Promise((resolve) => setTimeout(resolve, 30_000));');
    const runner = new Baselines({
      db: t.db,
      cwd: root,
      base,
      signal: new AbortController().signal,
      limitMs: 1_000,
    });
    expect(await runner.evidence(failed)).toMatchObject({ outcome: 'timed_out', trusted: false });
    expect(await runner.evidence(failed)).toMatchObject({
      outcome: 'timed_out',
      trusted: false,
      cached: true,
    });
    await runner.dispose();
  });

  it('leaves no worktree behind and has no evidence when the base cannot be checked out', async () => {
    const base = commitCheck('process.exit(1);');
    const runner = baselines(base);
    await runner.evidence(failed);
    await runner.dispose();
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);

    const missing = baselines('0000000000000000000000000000000000000000');
    expect(await missing.evidence(failed)).toMatchObject({
      outcome: 'unavailable',
      trusted: false,
    });
    await missing.dispose();
  });

  it('stops with the run and remembers nothing', async () => {
    const base = commitCheck('await new Promise((resolve) => setTimeout(resolve, 30_000));');
    const control = new AbortController();
    const runner = baselines(base, control.signal);
    const pending = runner.evidence(failed);
    setTimeout(() => control.abort(), 1_000);
    expect(await pending).toBeNull();
    await runner.dispose();
    const { rows } = await t.db.query('SELECT 1 FROM check_baselines');
    expect(rows).toEqual([]);
  });
});
