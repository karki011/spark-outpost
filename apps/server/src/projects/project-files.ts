import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_FILES_LIMIT, type ProjectFilesResponse } from '@spark-outpost/contracts';
import { rankFiles } from './file-match.ts';
import { isSecretPath, type ProjectRoot } from './path-policy.ts';

const run = promisify(execFile);

export const WALK_FILE_LIMIT = 20_000;
const GIT_TIMEOUT_MS = 10_000;
const SKIPPED_DIRECTORIES = new Set(['node_modules']);

async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await run(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
    );
    return [...new Set(stdout.split('\0').filter(Boolean))];
  } catch {
    return null;
  }
}

async function walkFiles(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const pending = [''];
  while (pending.length > 0) {
    const relativeDir = pending.shift()!;
    let entries;
    try {
      entries = await readdir(path.join(root, relativeDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
          pending.push(relative);
        }
      } else if (entry.isFile()) {
        if (files.length >= WALK_FILE_LIMIT) return { files, truncated: true };
        files.push(relative);
      }
    }
  }
  return { files, truncated: false };
}

async function withSizes(root: string, relatives: readonly string[]) {
  const sized = await Promise.all(
    relatives.map(async (relative) => {
      try {
        const info = await stat(path.join(root, relative));
        return info.isFile() ? { path: relative, size: info.size } : null;
      } catch {
        return null;
      }
    }),
  );
  return sized.filter((file) => file !== null);
}

export async function listProjectFiles(
  root: ProjectRoot,
  query: string,
): Promise<ProjectFilesResponse> {
  const fromGit = await gitFiles(root.path);
  const listed = fromGit ? { files: fromGit, truncated: false } : await walkFiles(root.path);
  const visible = listed.files.filter((file) => !isSecretPath(file, root.ignore));
  const ranked = rankFiles(query, visible, PROJECT_FILES_LIMIT);
  return {
    files: await withSizes(root.path, ranked.paths),
    truncated: ranked.truncated || listed.truncated,
  };
}
