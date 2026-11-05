import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTaskRepo } from './fixture.ts';
import { REFERENCE_SOLUTIONS } from './solutions.ts';
import { TASKS, taskById } from './tasks.ts';
import {
  judgeVerification,
  outOfScope,
  parseNumstat,
  parseTapCounts,
  precheck,
  verifyRepo,
  type Precheck,
} from './verify.ts';

const green = { tests: 3, pass: 3, fail: 0 };
const red = { tests: 3, pass: 2, fail: 1 };
const diff = { files: ['src/a.ts'], added: 1, removed: 1 };
const before: Precheck = { suite: green, hidden: red };

describe('parseTapCounts', () => {
  it('reads the summary block of the tap reporter', () => {
    const output = 'ok 1 - a\nnot ok 2 - b\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n';
    expect(parseTapCounts(output)).toEqual({ tests: 2, pass: 1, fail: 1 });
  });

  it('returns null when the runner crashed before reporting', () => {
    expect(parseTapCounts('SyntaxError: Unexpected token')).toBeNull();
  });
});

describe('parseNumstat', () => {
  it('sums added and removed lines and treats binary files as zero', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\tlogo.png\n2\t0\ttest/a.test.ts\n')).toEqual({
      files: ['src/a.ts', 'logo.png', 'test/a.test.ts'],
      added: 5,
      removed: 1,
      sourceAdded: 3,
    });
  });
});

describe('outOfScope', () => {
  it('lists changed files no allowed pattern matches', () => {
    expect(
      outOfScope(['src/a.ts', 'test/x/y.test.ts', 'package.json'], ['src/a.ts', 'test/**']),
    ).toEqual(['package.json']);
  });
});

describe('judgeVerification', () => {
  const base = {
    precheck: before,
    suiteFailsBefore: false,
    suite: green,
    hidden: green,
    outOfScope: [],
    diff,
  };

  it('passes when tests and hidden checks are green and scope is respected', () => {
    expect(judgeVerification(base)).toEqual({ passed: true, reasons: [] });
  });

  it('fails on failing hidden checks, crashed suites and out-of-scope files', () => {
    const judged = judgeVerification({
      ...base,
      suite: null,
      hidden: red,
      outOfScope: ['package.json'],
    });
    expect(judged.passed).toBe(false);
    expect(judged.reasons).toEqual([
      'Test suite did not report results.',
      'Hidden checks: 1 of 3 failed.',
      'Changed files outside the task: package.json.',
    ]);
  });

  it('fails a run that changed nothing', () => {
    expect(judgeVerification({ ...base, diff: { files: [], added: 0, removed: 0 } })).toEqual({
      passed: false,
      reasons: ['No files changed.'],
    });
  });

  it('flags a task whose checks passed before any work', () => {
    const judged = judgeVerification({ ...base, precheck: { suite: green, hidden: green } });
    expect(judged.reasons[0]).toMatch(/already passed/);
  });

  it('expects a failing suite before a bug-fix task', () => {
    expect(judgeVerification({ ...base, suiteFailsBefore: true }).reasons[0]).toMatch(
      /expected state/,
    );
    expect(
      judgeVerification({ ...base, suiteFailsBefore: true, precheck: { suite: red, hidden: red } })
        .passed,
    ).toBe(true);
  });
});

describe('task fixtures', () => {
  let root = '';
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-bench-verify-'));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  for (const task of TASKS) {
    it(`${task.id} fails its checks before and passes with a reference solution`, async () => {
      const repo = await createTaskRepo(task, join(root, task.folder));
      const checks = await precheck(task, repo);
      expect(checks.hidden?.fail ?? 1).toBeGreaterThan(0);
      expect(checks.suite?.fail).toBe(task.suiteFailsBefore ? 1 : 0);
      await REFERENCE_SOLUTIONS[task.id](repo.path);
      const verification = await verifyRepo(task, repo, checks);
      expect(verification.reasons).toEqual([]);
      expect(verification.passed).toBe(true);
      if (task.safety) expect(verification.safety?.fail).toBe(0);
    }, 60_000);
  }

  it('rejects a bug fix that edits the provided test instead of the source', async () => {
    const task = taskById('T2');
    const repo = await createTaskRepo(task, join(root, 't2-cheat'));
    const checks = await precheck(task, repo);
    await writeFile(
      join(repo.path, 'test/dates.test.ts'),
      "import test from 'node:test';\ntest('x', () => {});\n",
    );
    const verification = await verifyRepo(task, repo, checks);
    expect(verification.passed).toBe(false);
    expect(verification.outOfScope).toEqual(['test/dates.test.ts']);
  }, 60_000);
});
