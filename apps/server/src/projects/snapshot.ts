import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readlink, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RunChange } from '@spark-outpost/contracts';
import {
  racySafeSecond,
  saveSnapshotIndex,
  seedSnapshotIndex,
  snapshotIndexPath,
} from './snapshot-index.ts';
import { sendInput } from './child-input.ts';

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

const SNAPSHOT_REF_PREFIX = 'refs/spark-outpost/runs/';
const END_REF_PREFIX = 'refs/spark-outpost/run-ends/';

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

export const SNAPSHOT_PATHSPEC = ['.', ':(exclude,glob)**/node_modules/**'];

const VANISHED_FILE = /No such file or directory|unable to index file|unable to stat/;

export function isVanishedFileError(error: unknown): boolean {
  const failure = error as { stderr?: unknown; message?: unknown };
  return VANISHED_FILE.test(`${String(failure.stderr ?? '')}\n${String(failure.message ?? '')}`);
}

async function addAll(root: string, env: NodeJS.ProcessEnv): Promise<void> {
  const add = () => git(root, ['add', '-A', '--', ...SNAPSHOT_PATHSPEC], env);
  try {
    await add();
  } catch (error) {
    if (!isVanishedFileError(error)) throw error;
    await add();
  }
}

async function treeFromHead(root: string, head: string, index: string): Promise<string> {
  const env = { GIT_INDEX_FILE: index };
  const saved = await snapshotIndexPath(root, git);
  const startedSecond = racySafeSecond();
  const seeded = saved !== null && (await seedSnapshotIndex(saved, index));
  try {
    await git(root, seeded ? ['read-tree', '--reset', head] : ['read-tree', head], env);
  } catch (error) {
    if (!seeded) throw error;
    await rm(index, { force: true });
    await git(root, ['read-tree', head], env);
  }
  await addAll(root, env);
  const tree = (await git(root, ['write-tree'], env)).trim();
  if (saved !== null) await saveSnapshotIndex(index, saved, startedSecond);
  return tree;
}

export async function workingTree(root: string): Promise<string> {
  const scratch = await mkdtemp(path.join(tmpdir(), 'spark-outpost-index-'));
  const index = path.join(scratch, 'index');
  try {
    const head = await headCommit(root);
    if (head) return await treeFromHead(root, head, index);
    const env = { GIT_INDEX_FILE: index };
    await git(root, ['read-tree', '--empty'], env);
    await addAll(root, env);
    return (await git(root, ['write-tree'], env)).trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export const HARNESS_COMMIT_EMAIL = 'snapshots@spark-outpost.local';

export const HARNESS_AUTHOR = {
  GIT_AUTHOR_NAME: 'Spark Outpost',
  GIT_AUTHOR_EMAIL: HARNESS_COMMIT_EMAIL,
  GIT_COMMITTER_NAME: 'Spark Outpost',
  GIT_COMMITTER_EMAIL: HARNESS_COMMIT_EMAIL,
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

export async function takeGitEndSnapshot(
  root: string,
  runId: string,
  start: string,
): Promise<string> {
  const commit = await commitWorkingTree(root, [start], `Spark Outpost: after run ${runId}`);
  await git(root, ['update-ref', `${END_REF_PREFIX}${runId}`, commit]);
  return commit;
}

export async function blobAt(root: string, ref: string, relative: string): Promise<string | null> {
  try {
    return (
      (await git(root, ['rev-parse', '--verify', '-q', `${ref}:./${relative}`])).trim() || null
    );
  } catch {
    return null;
  }
}

function hashLinkText(root: string, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-C', root, 'hash-object', '--stdin'],
      { timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );
    sendInput(child, text);
  });
}

export async function worktreeBlob(root: string, relative: string): Promise<string | null> {
  try {
    const target = path.join(root, relative);
    if ((await lstat(target)).isSymbolicLink()) {
      return (await hashLinkText(root, await readlink(target))) || null;
    }
    return (await git(root, ['hash-object', '--', relative])).trim() || null;
  } catch {
    return null;
  }
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
  for (const relative of added) {
    await unlink(path.join(root, relative)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  if (restored.length > 0) {
    const literal = restored.map((relative) => `:(literal)${relative}`);
    await git(root, ['restore', `--source=${snapshot}`, '--worktree', '--', ...literal]);
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
  paths?: readonly string[],
): Promise<{ stats: FileStat[]; patch: string }> {
  if (paths && paths.length === 0) return { stats: [], patch: '' };
  const only = paths ? ['--', ...paths.map((file) => `:(literal)${file}`)] : [];
  const range = ['--no-renames', '--relative', from, to, ...only];
  const [numstat, patch] = await Promise.all([
    git(root, ['diff', '--numstat', ...range]),
    git(root, ['diff', ...range]),
  ]);
  return { stats: parseNumstat(numstat), patch };
}
