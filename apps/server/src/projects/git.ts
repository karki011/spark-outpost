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

export async function isRepository(root: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--is-inside-work-tree'])) === 'true';
}

export async function initRepository(root: string): Promise<boolean> {
  if (await isRepository(root)) return false;
  try {
    await run('git', ['-C', root, 'init', '--quiet'], { timeout: GIT_TIMEOUT_MS });
  } catch {
    throw new FolderError("Git couldn't make this folder a repository.");
  }
  return true;
}
