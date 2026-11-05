import { execFile } from 'node:child_process';
import { glob, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_READ_MAX_BYTES } from '../projects/path-policy.ts';

const run = promisify(execFile);

export interface ScriptFile {
  text: string | null;
  committed: boolean;
}

export interface FileLister {
  glob: (pattern: string, cwd: string) => string[] | null;
  walk: (target: string) => string[] | null;
  script: (target: string) => ScriptFile | null;
}

export interface FileSource {
  glob: (pattern: string, cwd: string) => Promise<string[] | null>;
  walk: (target: string) => Promise<string[] | null>;
  script: (target: string) => Promise<ScriptFile | null>;
}

function unlisted(): never {
  throw new Error('This approval decision has no file source');
}

export const NO_FILES: FileLister = { glob: unlisted, walk: unlisted, script: unlisted };

const MAX_ENTRIES = 20_000;
const GIT_TIMEOUT_MS = 5_000;
const SKIPPED_DIRS = new Set(['node_modules', '.git']);

async function isDirectory(target: string): Promise<boolean | null> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return null;
  }
}

async function entriesOf(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function walkTree(root: string): Promise<string[] | null> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    for (const entry of await entriesOf(dir)) {
      if (files.length >= MAX_ENTRIES) return null;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) pending.push(full);
      } else files.push(full);
    }
  }
  return files;
}

async function committedUnchanged(file: string): Promise<boolean> {
  try {
    const { stdout } = await run(
      'git',
      ['status', '--porcelain', '--ignored', '--untracked-files=all', '--', path.basename(file)],
      { cwd: path.dirname(file), encoding: 'utf8', timeout: GIT_TIMEOUT_MS },
    );
    return stdout.trim() === '';
  } catch {
    return false;
  }
}

async function readScript(target: string): Promise<ScriptFile | null> {
  try {
    const real = await realpath(target);
    const stats = await stat(real);
    if (!stats.isFile()) return null;
    const text = stats.size > PROJECT_READ_MAX_BYTES ? null : await readFile(real, 'utf8');
    return { text, committed: await committedUnchanged(real) };
  } catch {
    return null;
  }
}

async function globFiles(pattern: string, cwd: string): Promise<string[] | null> {
  try {
    const found: string[] = [];
    const matches = glob(pattern, {
      cwd,
      exclude: (name) => SKIPPED_DIRS.has(path.basename(String(name))),
    });
    for await (const match of matches) {
      if (found.length >= MAX_ENTRIES) return null;
      found.push(path.resolve(cwd, match));
    }
    return found;
  } catch {
    return null;
  }
}

export const diskFiles: FileSource = {
  glob: globFiles,
  walk: async (target) => {
    const directory = await isDirectory(target);
    if (directory === null) return [];
    return directory ? walkTree(target) : [target];
  },
  script: readScript,
};
