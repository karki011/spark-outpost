import { execFileSync } from 'node:child_process';
import { globSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_READ_MAX_BYTES } from '../projects/path-policy.ts';

export interface ScriptFile {
  text: string | null;
  committed: boolean;
}

export interface FileLister {
  glob: (pattern: string, cwd: string) => string[] | null;
  walk: (target: string) => string[] | null;
  script: (target: string) => ScriptFile | null;
}

const MAX_ENTRIES = 20_000;
const GIT_TIMEOUT_MS = 5_000;
const SKIPPED_DIRS = new Set(['node_modules', '.git']);

function isDirectory(target: string): boolean | null {
  try {
    return statSync(target).isDirectory();
  } catch {
    return null;
  }
}

function walkTree(root: string): string[] | null {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= MAX_ENTRIES) return null;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) pending.push(full);
      } else files.push(full);
    }
  }
  return files;
}

function committedUnchanged(file: string): boolean {
  try {
    const status = execFileSync(
      'git',
      ['status', '--porcelain', '--ignored', '--untracked-files=all', '--', path.basename(file)],
      {
        cwd: path.dirname(file),
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return status.trim() === '';
  } catch {
    return false;
  }
}

function readScript(target: string): ScriptFile | null {
  try {
    const real = realpathSync(target);
    const stats = statSync(real);
    if (!stats.isFile()) return null;
    const text = stats.size > PROJECT_READ_MAX_BYTES ? null : readFileSync(real, 'utf8');
    return { text, committed: committedUnchanged(real) };
  } catch {
    return null;
  }
}

export const diskLister: FileLister = {
  glob: (pattern, cwd) => {
    try {
      const found = globSync(pattern, {
        cwd,
        exclude: (name) => SKIPPED_DIRS.has(path.basename(String(name))),
      });
      return found.length > MAX_ENTRIES ? null : found.map((match) => path.resolve(cwd, match));
    } catch {
      return null;
    }
  },
  walk: (target) => {
    const directory = isDirectory(target);
    if (directory === null) return [];
    return directory ? walkTree(target) : [target];
  },
  script: readScript,
};
