import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { SNAPSHOT_REF_PREFIX, commitWorkingTree, git, headCommit } from './snapshot.ts';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export const WORKTREES_DIR = path.join('.spark', 'worktrees');
export const RESULT_REF_PREFIX = 'refs/spark-outpost/builders/';
const EXCLUDE_LINE = '.spark/';

export function worktreePath(root: string, runId: string): string {
  return path.join(root, WORKTREES_DIR, runId);
}

export const DEFAULT_BRANCH_PREFIX = 'spark';

export function branchName(
  taskId: string | null,
  name: string,
  prefix = DEFAULT_BRANCH_PREFIX,
): string {
  const task = (taskId ?? 'task').slice(0, 8);
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'agent';
  return `${prefix}/${task}/${slug}`;
}

export async function repoTop(root: string): Promise<string> {
  return (await git(root, ['rev-parse', '--show-toplevel'])).trim();
}

export async function excludeSparkDir(root: string): Promise<void> {
  const relative = (await git(root, ['rev-parse', '--git-path', 'info/exclude'])).trim();
  const file = path.resolve(root, relative);
  const current = await readFile(file, 'utf8').catch(() => '');
  if (current.split('\n').some((line) => line.trim() === EXCLUDE_LINE)) return;
  await mkdir(path.dirname(file), { recursive: true });
  const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
  await appendFile(file, `${prefix}${EXCLUDE_LINE}\n`);
}

export async function groupBase(root: string, label: string): Promise<string> {
  const head = await headCommit(root);
  return commitWorkingTree(root, head ? [head] : [], `Spark Outpost: parallel base ${label}`);
}

export async function addWorktree(
  root: string,
  target: string,
  branch: string,
  base: string,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await git(root, ['worktree', 'add', '--quiet', '-B', branch, target, base]);
}

export async function commitWorktree(
  root: string,
  target: string,
  branch: string,
  base: string,
  runId: string,
): Promise<string> {
  const commit = await commitWorkingTree(target, [base], `Spark Outpost: ${branch}`);
  await git(root, ['update-ref', `refs/heads/${branch}`, commit]);
  await git(root, ['update-ref', `${RESULT_REF_PREFIX}${runId}`, commit]);
  return commit;
}

export async function pinSnapshot(root: string, runId: string, commit: string): Promise<void> {
  await git(root, ['update-ref', `${SNAPSHOT_REF_PREFIX}${runId}`, commit]);
}

export async function removeWorktree(root: string, target: string, branch: string): Promise<void> {
  await git(root, ['worktree', 'remove', '--force', target]).catch(() => undefined);
  await rm(target, { recursive: true, force: true });
  await git(root, ['worktree', 'prune']).catch(() => undefined);
  await git(root, ['branch', '-D', branch]).catch(() => undefined);
}

export interface MergeAttempt {
  current: string;
  tree: string;
  conflicts: string[];
}

export async function tryMerge(root: string, base: string, result: string): Promise<MergeAttempt> {
  const current = await commitWorkingTree(root, [base], 'Spark Outpost: main copy before merge');
  try {
    const { stdout } = await run(
      'git',
      ['-C', root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', current, result],
      { maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    return { current, tree: stdout.split('\n')[0]!.trim(), conflicts: [] };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    if (failure.code !== 1 || !failure.stdout) throw error;
    const [tree, ...files] = failure.stdout.split('\n').map((line) => line.trim());
    return { current, tree: tree!, conflicts: [...new Set(files.filter(Boolean))] };
  }
}

function literal(paths: readonly string[]): string[] {
  return paths.map((file) => `:(exclude,top,literal)${file}`);
}

export async function applyTree(
  root: string,
  from: string,
  to: string,
  skip: readonly string[] = [],
): Promise<void> {
  const patch = await git(root, [
    'diff',
    '--binary',
    '--no-renames',
    from,
    to,
    '--',
    '.',
    ...literal(skip),
  ]);
  if (!patch.trim()) return;
  const top = await repoTop(root);
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'git',
      ['-C', top, 'apply', '--whitespace=nowarn', '-'],
      { maxBuffer: MAX_BUFFER },
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin?.end(patch);
  });
}

export async function takeFileFrom(root: string, commit: string, file: string): Promise<void> {
  const top = await repoTop(root);
  const present = await git(top, ['ls-tree', '--name-only', commit, '--', file]);
  if (present.trim()) {
    await git(top, ['restore', `--source=${commit}`, '--worktree', '--', `:(literal)${file}`]);
    return;
  }
  await rm(path.join(top, file), { force: true });
}

export async function fileDiff(
  root: string,
  from: string,
  to: string,
  file: string,
): Promise<string> {
  return git(root, ['diff', '--no-renames', from, to, '--', `:(top,literal)${file}`]);
}
