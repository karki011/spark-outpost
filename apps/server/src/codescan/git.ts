import { rgPath } from '@vscode/ripgrep';
import { runCommand } from './processes.ts';

export const HISTORY_COMMITS = 500;
export const MAX_COMMIT_FILES = 100;

export interface Commit {
  at: number;
  files: string[];
}

const RECORD = '\u001e';

function git(root: string, args: string[], signal?: AbortSignal): Promise<string> {
  return runCommand('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: root,
    ...(signal ? { signal } : {}),
  });
}

function splitNul(output: string): string[] {
  return output.split('\0').filter((entry) => entry.length > 0);
}

export async function listProjectFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const output = await git(
      root,
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      signal,
    );
    return [...new Set(splitNul(output))];
  } catch {
    const output = await runCommand(rgPath, ['--files', '--null'], {
      cwd: root,
      ...(signal ? { signal } : {}),
    });
    return splitNul(output).map((path) => path.replace(/^\.\//, ''));
  }
}

export async function headCommit(root: string): Promise<string | null> {
  try {
    return (await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null;
  } catch {
    return null;
  }
}

export async function changedSince(root: string, commit: string): Promise<string[] | null> {
  try {
    return splitNul(await git(root, ['diff', '--name-only', '-z', commit, 'HEAD']));
  } catch {
    return null;
  }
}

export function parseStatus(output: string): string[] {
  const entries = output.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') index += 1;
  }
  return paths;
}

export async function workingChanges(root: string, signal?: AbortSignal): Promise<string[]> {
  try {
    return parseStatus(
      await git(root, ['--no-optional-locks', 'status', '--porcelain=v1', '-z'], signal),
    );
  } catch {
    return [];
  }
}

export function parseLog(output: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of output.split(RECORD)) {
    const lines = record.split('\n').filter((line) => line.length > 0);
    const at = Number(lines[0]);
    if (!Number.isFinite(at) || lines.length < 2) continue;
    commits.push({ at, files: lines.slice(1) });
  }
  return commits;
}

export async function recentHistory(root: string): Promise<Commit[]> {
  try {
    const output = await git(root, [
      'log',
      `-n${HISTORY_COMMITS}`,
      '--no-merges',
      '--name-only',
      `--format=${RECORD}%ct`,
    ]);
    return parseLog(output).filter((commit) => commit.files.length <= MAX_COMMIT_FILES);
  } catch {
    return [];
  }
}
