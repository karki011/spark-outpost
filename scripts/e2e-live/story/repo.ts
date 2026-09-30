import { execFile } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseTapCounts, type TestCounts } from '../../bench/verify.ts';
import { createRepo, git, type DayRepo } from '../dev-day/repos.ts';
import { STORY_HIDDEN } from './story.ts';

const run = promisify(execFile);
const STORY_DIR = import.meta.dirname;
export const STORY_FIXTURE = join(STORY_DIR, 'fixture');
export const STORY_REFERENCE = join(STORY_DIR, 'reference');
const HIDDEN_DIR = 'bench-verify';

export interface HiddenResult {
  counts: TestCounts | null;
  failing: string[];
}

export async function createStoryRepo(dir: string, name: string): Promise<DayRepo> {
  const repo = await createRepo('workbench', dir, name);
  await cp(STORY_FIXTURE, repo.path, { recursive: true });
  git(repo.path, 'add', '-A');
  git(repo.path, 'commit', '-qm', 'Workbench: project page, analytics and CSV export');
  git(repo.path, 'push', '-q', 'origin', 'main');
  return repo;
}

export async function applyReference(repo: string): Promise<void> {
  await cp(STORY_REFERENCE, repo, { recursive: true });
}

async function tapOutput(repo: string, pattern: string): Promise<string> {
  return run(process.execPath, ['--test', '--test-reporter=tap', pattern], {
    cwd: repo,
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  }).then(
    (result) => `${result.stdout}${result.stderr}`,
    (error: { stdout?: string; stderr?: string }) => `${error.stdout ?? ''}${error.stderr ?? ''}`,
  );
}

export function failingTests(tap: string): string[] {
  return [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]!.trim());
}

export async function testsIn(repo: string, pattern: string): Promise<HiddenResult> {
  const tap = await tapOutput(repo, pattern);
  return { counts: parseTapCounts(tap), failing: failingTests(tap) };
}

export async function storyHidden(repo: string): Promise<HiddenResult> {
  const dir = join(repo, HIDDEN_DIR);
  await mkdir(dir, { recursive: true });
  await cp(join(STORY_DIR, 'hidden', STORY_HIDDEN), join(dir, STORY_HIDDEN));
  try {
    return await testsIn(repo, `${HIDDEN_DIR}/${STORY_HIDDEN}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const storySuite = (repo: string) => testsIn(repo, 'test/**/*.test.ts');
