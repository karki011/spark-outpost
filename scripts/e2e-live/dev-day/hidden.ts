import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseTapCounts, type TestCounts } from '../../bench/verify.ts';
import { FIXTURES } from './repos.ts';
import type { RepoKey } from './sessions.ts';

const run = promisify(execFile);

export const HIDDEN_DIRS: Record<Exclude<RepoKey, 'external'>, string> = {
  spark: 'apps/web/src/__devday_hidden__',
  workbench: 'bench-verify',
};

const SUPPORT: Record<Exclude<RepoKey, 'external'>, string[]> = {
  spark: [],
  workbench: ['support.ts'],
};

async function output(command: string, args: string[], cwd: string): Promise<string> {
  return run(command, args, { cwd, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 }).then(
    (result) => `${result.stdout}${result.stderr}`,
    (error: { stdout?: string; stderr?: string }) => `${error.stdout ?? ''}${error.stderr ?? ''}`,
  );
}

async function vitestCounts(
  repo: string,
  target: string,
  scratch: string,
): Promise<TestCounts | null> {
  const report = join(scratch, `vitest-${Date.now()}.json`);
  await output(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--project',
      'unit',
      target,
      '--reporter=json',
      `--outputFile=${report}`,
    ],
    repo,
  );
  const text = await readFile(report, 'utf8').catch(() => null);
  await rm(report, { force: true });
  if (!text) return null;
  const parsed = JSON.parse(text) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
  };
  return {
    tests: parsed.numTotalTests,
    pass: parsed.numPassedTests,
    fail: parsed.numTotalTests - parsed.numPassedTests,
  };
}

async function nodeCounts(repo: string, pattern: string): Promise<TestCounts | null> {
  const text = await output(process.execPath, ['--test', '--test-reporter=tap', pattern], repo);
  return parseTapCounts(text);
}

export async function suiteCounts(
  key: RepoKey,
  repo: string,
  scratch: string,
): Promise<TestCounts | null> {
  if (key === 'spark') return vitestCounts(repo, 'apps/web/src/analytics', scratch);
  if (key === 'workbench') return nodeCounts(repo, 'test/**/*.test.ts');
  return null;
}

export async function hiddenCounts(
  key: RepoKey,
  repo: string,
  file: string,
  scratch: string,
): Promise<TestCounts | null> {
  if (key === 'external') return null;
  const dir = join(repo, HIDDEN_DIRS[key]);
  await mkdir(dir, { recursive: true });
  await mkdir(scratch, { recursive: true });
  for (const name of [file, ...SUPPORT[key]]) {
    await cp(join(FIXTURES, 'hidden', key, name), join(dir, name));
  }
  try {
    const target = `${HIDDEN_DIRS[key]}/${file}`;
    return key === 'spark'
      ? await vitestCounts(repo, target, scratch)
      : await nodeCounts(repo, target);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
