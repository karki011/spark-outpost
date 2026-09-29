import { globSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface FileLister {
  glob: (pattern: string, cwd: string) => string[] | null;
  walk: (target: string) => string[] | null;
}

const MAX_ENTRIES = 20_000;
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
};
