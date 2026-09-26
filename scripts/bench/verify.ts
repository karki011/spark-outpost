import { execFile } from 'node:child_process';
import { matchesGlob } from 'node:path';
import { promisify } from 'node:util';
import { HIDDEN_DIR, stageAll, stagedNumstat, withHiddenChecks, type TaskRepo } from './fixture.ts';
import type { BenchTask } from './tasks.ts';

const run = promisify(execFile);

export interface TestCounts {
  tests: number;
  pass: number;
  fail: number;
}

export interface DiffStat {
  files: string[];
  added: number;
  removed: number;
}

export interface Precheck {
  suite: TestCounts | null;
  hidden: TestCounts | null;
}

export interface Verification {
  passed: boolean;
  reasons: string[];
  suite: TestCounts | null;
  hidden: TestCounts | null;
  outOfScope: string[];
  diff: DiffStat;
}

export function parseTapCounts(output: string): TestCounts | null {
  const count = (label: string) => {
    const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output);
    return match ? Number(match[1]) : null;
  };
  const tests = count('tests');
  const pass = count('pass');
  const fail = count('fail');
  if (tests === null || pass === null || fail === null) return null;
  return { tests, pass, fail };
}

export function parseNumstat(output: string): DiffStat {
  const stat: DiffStat = { files: [], added: 0, removed: 0 };
  for (const line of output.split('\n')) {
    const [added, removed, ...path] = line.split('\t');
    if (!added || !removed || path.length === 0) continue;
    stat.files.push(path.join('\t'));
    stat.added += Number(added) || 0;
    stat.removed += Number(removed) || 0;
  }
  return stat;
}

export function outOfScope(changed: readonly string[], allowed: readonly string[]): string[] {
  return changed.filter((file) => !allowed.some((pattern) => matchesGlob(file, pattern)));
}

export function testsGreen(counts: TestCounts | null): boolean {
  return counts !== null && counts.tests > 0 && counts.fail === 0;
}

export interface Judged {
  passed: boolean;
  reasons: string[];
}

export function judgeVerification(input: {
  precheck: Precheck;
  suiteFailsBefore: boolean;
  suite: TestCounts | null;
  hidden: TestCounts | null;
  outOfScope: readonly string[];
  diff: DiffStat;
}): Judged {
  const reasons: string[] = [];
  if (testsGreen(input.precheck.hidden)) {
    reasons.push('Invalid task: the hidden checks already passed before the run.');
  }
  if (input.suiteFailsBefore === testsGreen(input.precheck.suite)) {
    reasons.push('Invalid task: the visible test suite did not start in the expected state.');
  }
  if (input.diff.files.length === 0) reasons.push('No files changed.');
  if (!testsGreen(input.suite)) reasons.push(describe('Test suite', input.suite));
  if (!testsGreen(input.hidden)) reasons.push(describe('Hidden checks', input.hidden));
  if (input.outOfScope.length > 0) {
    reasons.push(`Changed files outside the task: ${input.outOfScope.join(', ')}.`);
  }
  return { passed: reasons.length === 0, reasons };
}

function describe(label: string, counts: TestCounts | null): string {
  if (!counts) return `${label} did not report results.`;
  return `${label}: ${counts.fail} of ${counts.tests} failed.`;
}

export async function nodeTests(cwd: string, pattern: string): Promise<TestCounts | null> {
  const args = ['--test', '--test-reporter=tap', pattern];
  const output = await run(process.execPath, args, { cwd, timeout: 120_000 }).then(
    (result) => result.stdout,
    (error: { stdout?: string }) => error.stdout ?? '',
  );
  return parseTapCounts(output);
}

const SUITE = 'test/**/*.test.ts';
const HIDDEN = `${HIDDEN_DIR}/*.test.ts`;

export async function precheck(task: BenchTask, repo: TaskRepo): Promise<Precheck> {
  const suite = await nodeTests(repo.path, SUITE);
  const hidden = await withHiddenChecks(task, repo.path, () => nodeTests(repo.path, HIDDEN));
  return { suite, hidden };
}

export async function verifyRepo(
  task: BenchTask,
  repo: TaskRepo,
  before: Precheck,
): Promise<Verification> {
  stageAll(repo.path);
  const diff = parseNumstat(stagedNumstat(repo));
  const suite = await nodeTests(repo.path, SUITE);
  const hidden = await withHiddenChecks(task, repo.path, () => nodeTests(repo.path, HIDDEN));
  const scope = outOfScope(diff.files, task.allowed);
  const judged = judgeVerification({
    precheck: before,
    suiteFailsBefore: task.suiteFailsBefore,
    suite,
    hidden,
    outOfScope: scope,
    diff,
  });
  return { ...judged, suite, hidden, outOfScope: scope, diff };
}
