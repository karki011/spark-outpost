import { execFile } from 'node:child_process';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RunChange } from '@spark-outpost/contracts';

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export const SNAPSHOT_REF_PREFIX = 'refs/spark-outpost/runs/';

export async function git(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const { stdout } = await run('git', ['-C', root, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout;
}

export async function gitFileAt(
  root: string,
  ref: string,
  relative: string,
): Promise<Buffer | null> {
  try {
    const { stdout } = await run('git', ['-C', root, 'show', `${ref}:${relative}`], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: 'buffer',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch {
    return null;
  }
}

export async function isGitWorkTree(root: string): Promise<boolean> {
  try {
    return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

export async function headCommit(root: string): Promise<string | null> {
  try {
    return (await git(root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'])).trim() || null;
  } catch {
    return null;
  }
}

export async function workingTree(root: string): Promise<string> {
  const scratch = await mkdtemp(path.join(tmpdir(), 'spark-outpost-index-'));
  const env = { GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    const head = await headCommit(root);
    await git(root, head ? ['read-tree', head] : ['read-tree', '--empty'], env);
    await git(root, ['add', '-A', '--', '.'], env);
    return (await git(root, ['write-tree'], env)).trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const HARNESS_AUTHOR = {
  GIT_AUTHOR_NAME: 'Spark Outpost',
  GIT_AUTHOR_EMAIL: 'snapshots@spark-outpost.local',
  GIT_COMMITTER_NAME: 'Spark Outpost',
  GIT_COMMITTER_EMAIL: 'snapshots@spark-outpost.local',
};

export async function commitWorkingTree(
  root: string,
  parents: readonly string[],
  message: string,
): Promise<string> {
  const tree = await workingTree(root);
  const parentArgs = parents.flatMap((parent) => ['-p', parent]);
  return (
    await git(root, ['commit-tree', tree, ...parentArgs, '-m', message], HARNESS_AUTHOR)
  ).trim();
}

export async function takeGitSnapshot(root: string, runId: string): Promise<string> {
  const head = await headCommit(root);
  const commit = await commitWorkingTree(
    root,
    head ? [head] : [],
    `Spark Outpost: before run ${runId}`,
  );
  await git(root, ['update-ref', `${SNAPSHOT_REF_PREFIX}${runId}`, commit]);
  return commit;
}

const CHANGE_CODES: Record<string, RunChange['change']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  T: 'modified',
};

export function parseNameStatus(output: string): RunChange[] {
  const parts = output.split('\0').filter((part) => part !== '');
  const changes: RunChange[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const change = CHANGE_CODES[parts[index]!.charAt(0)];
    if (change) changes.push({ path: parts[index + 1]!, change });
  }
  return changes;
}

export async function gitChanges(
  root: string,
  snapshot: string,
  until: string | null = null,
): Promise<RunChange[]> {
  const current = until ?? (await workingTree(root));
  const output = await git(root, [
    'diff',
    '--no-renames',
    '--name-status',
    '--relative',
    '-z',
    snapshot,
    current,
  ]);
  return parseNameStatus(output);
}

export async function revertGitChanges(
  root: string,
  snapshot: string,
  changes: readonly RunChange[],
): Promise<void> {
  const restored = changes.filter((change) => change.change !== 'added').map((c) => c.path);
  const added = changes.filter((change) => change.change === 'added').map((c) => c.path);
  if (restored.length > 0) {
    const literal = restored.map((relative) => `:(literal)${relative}`);
    await git(root, ['restore', `--source=${snapshot}`, '--worktree', '--', ...literal]);
  }
  for (const relative of added) {
    await unlink(path.join(root, relative)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}

export function parseNumstat(output: string): FileStat[] {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const [added, deleted, ...rest] = line.split('\t');
      const target = rest.join('\t');
      if (!target) return [];
      return [
        {
          path: target,
          additions: added === '-' ? 0 : Number(added),
          deletions: deleted === '-' ? 0 : Number(deleted),
        },
      ];
    });
}

export async function gitDiffSince(
  root: string,
  snapshot: string,
): Promise<{ stats: FileStat[]; patch: string }> {
  return gitDiffBetween(root, snapshot, await workingTree(root));
}

export async function gitDiffBetween(
  root: string,
  from: string,
  to: string,
): Promise<{ stats: FileStat[]; patch: string }> {
  const range = ['--no-renames', '--relative', from, to];
  const [numstat, patch] = await Promise.all([
    git(root, ['diff', '--numstat', ...range]),
    git(root, ['diff', ...range]),
  ]);
  return { stats: parseNumstat(numstat), patch };
}

export async function commitTree(root: string, commit: string): Promise<string> {
  return (await git(root, ['rev-parse', `${commit}^{tree}`])).trim();
}
