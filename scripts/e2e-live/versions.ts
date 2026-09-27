import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Version } from './plan.ts';
import { ROOT } from './stack.ts';

const run = promisify(execFile);

export function versionRoot(dir: string, version: Version): string {
  return version === 'current' ? ROOT : join(dir, '..', 'versions', version);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export async function prepareVersion(dir: string, version: Version): Promise<string> {
  const root = versionRoot(dir, version);
  if (version === 'current') return root;
  if (!(await exists(join(root, 'package.json')))) {
    await run('git', ['-C', ROOT, 'worktree', 'add', '--detach', root, version]);
  }
  if (!(await exists(join(root, 'node_modules', '.bin', 'tsx')))) {
    await run('pnpm', ['install', '--offline', '--frozen-lockfile'], {
      cwd: root,
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  return root;
}

export async function removeVersion(dir: string, version: Version): Promise<void> {
  if (version === 'current') return;
  const root = versionRoot(dir, version);
  if (await exists(root)) await run('git', ['-C', ROOT, 'worktree', 'remove', '--force', root]);
  await run('git', ['-C', ROOT, 'worktree', 'prune']);
}
