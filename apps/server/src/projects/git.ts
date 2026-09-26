import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
