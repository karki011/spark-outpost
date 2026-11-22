import { execFile } from 'node:child_process';
import { glob, readdir, readFile, realpath, stat } from 'node:fs/promises';
import {
  gatePaths as path,
  gateRelative,
  isWindowsPath,
  nativeOrNull,
  toGatePath,
  toNativePath,
} from './gate-path.ts';
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
  const native = nativeOrNull(target);
  if (native === null) return null;
  try {
    return (await stat(native)).isDirectory();
  } catch {
    return null;
  }
}

async function entriesOf(dir: string) {
  const native = nativeOrNull(dir);
  if (native === null) return [];
  try {
    return await readdir(native, { withFileTypes: true });
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
      { cwd: toNativePath(path.dirname(file)), encoding: 'utf8', timeout: GIT_TIMEOUT_MS },
    );
    return stdout.trim() === '';
  } catch {
    return false;
  }
}

async function readScript(target: string): Promise<ScriptFile | null> {
  const written = nativeOrNull(target);
  if (written === null) return null;
  try {
    const native = await realpath(written);
    const real = toGatePath(native);
    const stats = await stat(native);
    if (!stats.isFile()) return null;
    const text = stats.size > PROJECT_READ_MAX_BYTES ? null : await readFile(native, 'utf8');
    return { text, committed: await committedUnchanged(real) };
  } catch {
    return null;
  }
}

function nativePattern(pattern: string): string {
  if (!path.isAbsolute(pattern)) return pattern;
  return gateRelative(toNativePath(pattern));
}

function gateMatch(match: string): string {
  return isWindowsPath(match) ? toGatePath(match) : gateRelative(match);
}

async function globFiles(pattern: string, cwd: string): Promise<string[] | null> {
  const nativeCwd = nativeOrNull(cwd);
  if (nativeCwd === null) return [];
  try {
    const found: string[] = [];
    const matches = glob(nativePattern(pattern), {
      cwd: nativeCwd,
      exclude: (name) => SKIPPED_DIRS.has(path.basename(String(name))),
    });
    for await (const match of matches) {
      if (found.length >= MAX_ENTRIES) return null;
      found.push(path.resolve(cwd, gateMatch(match)));
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
