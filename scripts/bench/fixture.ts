import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchTask } from './tasks.ts';

const FIXTURE = fileURLToPath(new URL('./fixture/', import.meta.url));
export const HIDDEN_DIR = 'bench-verify';

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.email=bench@spark.local', '-c', 'user.name=bench', ...args],
    { encoding: 'utf8' },
  );
}

async function exists(path: string): Promise<boolean> {
  return readdir(path).then(
    () => true,
    () => false,
  );
}

export interface TaskRepo {
  path: string;
  base: string;
}

export async function createTaskRepo(task: BenchTask, repo: string): Promise<TaskRepo> {
  await rm(repo, { recursive: true, force: true });
  await mkdir(repo, { recursive: true });
  await cp(join(FIXTURE, 'base'), repo, { recursive: true });
  const setup = join(FIXTURE, 'tasks', task.folder, 'setup');
  if (await exists(setup)) await cp(setup, repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'Fixture');
  const pending = join(FIXTURE, 'tasks', task.folder, 'pending');
  if (await exists(pending)) await cp(pending, repo, { recursive: true });
  return { path: repo, base: git(repo, 'rev-parse', 'HEAD').trim() };
}

export async function withHiddenChecks<T>(
  task: BenchTask,
  repo: string,
  work: () => Promise<T>,
): Promise<T> {
  const target = join(repo, HIDDEN_DIR);
  await cp(join(FIXTURE, 'tasks', task.folder, 'hidden'), target, { recursive: true });
  try {
    return await work();
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

export function stageAll(repo: string): void {
  git(repo, 'add', '-A');
}

export function stagedNumstat(repo: TaskRepo): string {
  return git(repo.path, 'diff', '--cached', '--numstat', repo.base);
}
