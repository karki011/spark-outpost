import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FolderError } from './folders.ts';

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 2_000;

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', root, ...args], { timeout: GIT_TIMEOUT_MS });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function currentBranch(root: string): Promise<string | null> {
  return (
    (await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])) ??
    (await git(root, ['rev-parse', '--short', 'HEAD']))
  );
}

export interface RepositoryState {
  repository: boolean | null;
  problem: string | null;
}

const NOT_A_REPOSITORY = /not a git repository/i;

function firstLine(text: string): string {
  return (
    text
      .trim()
      .split('\n')[0]
      ?.replace(/^fatal:\s*/i, '') ?? ''
  );
}

export async function repositoryState(root: string): Promise<RepositoryState> {
  try {
    const { stdout } = await run('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
      timeout: GIT_TIMEOUT_MS,
    });
    return { repository: stdout.trim() === 'true', problem: null };
  } catch (error) {
    const failure = error as { stderr?: string; killed?: boolean; code?: unknown };
    const stderr = String(failure.stderr ?? '');
    if (NOT_A_REPOSITORY.test(stderr)) return { repository: false, problem: null };
    if (failure.killed) return { repository: null, problem: 'Git took too long to answer.' };
    if (failure.code === 'ENOENT') return { repository: null, problem: 'Git isn’t installed.' };
    return { repository: null, problem: firstLine(stderr) || 'Git couldn’t check this folder.' };
  }
}

export async function initRepository(root: string): Promise<void> {
  const state = await repositoryState(root);
  if (state.repository === true) {
    throw new FolderError('This folder is already a git repository.');
  }
  if (state.repository === null) {
    throw new FolderError(`Spark left this folder alone: ${state.problem}`);
  }
  try {
    await run('git', ['-C', root, 'init', '--quiet'], { timeout: GIT_TIMEOUT_MS });
  } catch {
    throw new FolderError("Git couldn't make this folder a repository.");
  }
}
