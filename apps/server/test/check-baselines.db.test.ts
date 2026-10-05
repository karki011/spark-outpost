import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Baselines } from '../src/checks/baseline.ts';
import { configuredChecks } from '../src/checks/detect.ts';
import { outputShape } from '../src/checks/failures.ts';
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

const failed = (failures: string[], output = '') => ({
  check: check!,
  failures,
  shape: outputShape(output),
  durationMs: 100,
});

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
  it('runs once per base commit and command, then answers from memory', async () => {
    const base = commitCheck("console.log(' FAIL  src/old.test.ts > x'); process.exit(1);");
    const first = baselines(base);
    const ran = await first.attribute(failed(['test src/old.test.ts']));
    await first.dispose();
    expect(ran).toMatchObject({
      fromChange: false,
      baseline: { outcome: 'failed', cached: false, shared: ['test src/old.test.ts'], added: [] },
    });
    expect(baseRuns()).toBe(1);

    const second = baselines(base);
    const remembered = await second.attribute(
      failed(['test src/new.test.ts', 'test src/old.test.ts']),
    );
    await second.dispose();
    expect(remembered).toMatchObject({
      fromChange: true,
      baseline: { cached: true, shared: ['test src/old.test.ts'], added: ['test src/new.test.ts'] },
    });
    expect(baseRuns()).toBe(1);

    const moved = commitCheck("console.log('fine');");
    const third = baselines(moved);
    const again = await third.attribute(failed(['test src/old.test.ts']));
    await third.dispose();
    expect(again).toMatchObject({
      fromChange: true,
      baseline: { outcome: 'passed', cached: false },
    });
    expect(baseRuns()).toBe(2);
  });

  it('compares the output when it names no failures', async () => {
    const base = commitCheck("console.error('boom'); process.exit(2);");
    const runner = baselines(base);
    expect(await runner.attribute(failed([], 'boom\n'))).toMatchObject({
      fromChange: false,
      baseline: { outcome: 'failed', shared: [], added: [] },
    });
    expect(await runner.attribute(failed([], 'a different problem\n'))).toMatchObject({
      fromChange: true,
      baseline: { outcome: 'failed', cached: true },
    });
    await runner.dispose();
  });

  it('leaves no worktree behind and blames the change when the base cannot be checked', async () => {
    const base = commitCheck('process.exit(1);');
    const runner = baselines(base);
    await runner.attribute(failed([]));
    await runner.dispose();
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);

    const missing = baselines('0000000000000000000000000000000000000000');
    expect(await missing.attribute(failed(['test a.test.ts']))).toMatchObject({
      fromChange: true,
      baseline: { outcome: 'unavailable' },
    });
    await missing.dispose();
  });

  it('stops with the run and remembers nothing', async () => {
    const base = commitCheck('await new Promise((resolve) => setTimeout(resolve, 30_000));');
    const control = new AbortController();
    const runner = baselines(base, control.signal);
    const pending = runner.attribute(failed([]));
    setTimeout(() => control.abort(), 1_000);
    expect(await pending).toBeNull();
    await runner.dispose();
    const { rows } = await t.db.query('SELECT 1 FROM check_baselines');
    expect(rows).toEqual([]);
  });
});
