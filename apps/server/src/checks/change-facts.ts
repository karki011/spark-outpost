import { access } from 'node:fs/promises';
import path from 'node:path';
import { git } from '../projects/snapshot.ts';
import type { ProjectFiles } from './detect.ts';
import type { ChangeFacts } from './scope.ts';

function lines(output: string): string[] {
  return output.split('\0').filter((line) => line !== '');
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function packageDirOf(cwd: string, file: string): Promise<string | null> {
  let dir = path.dirname(file);
  while (dir !== '.' && dir !== '') {
    if (await exists(path.join(cwd, dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

async function packageDirs(cwd: string, changed: readonly string[]): Promise<string[] | null> {
  const dirs = new Set<string>();
  for (const file of changed) {
    const dir = await packageDirOf(cwd, file);
    if (!dir) return null;
    dirs.add(dir);
  }
  return [...dirs].sort();
}

export async function changeFacts(
  cwd: string,
  base: string,
  files: ProjectFiles,
): Promise<ChangeFacts> {
  const [tracked, untracked] = await Promise.all([
    git(cwd, ['diff', '--name-only', '--no-renames', '--relative', '-z', base, '--', '.']),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.']),
  ]);
  const changed = [...new Set([...lines(tracked), ...lines(untracked)])].sort();
  const present = await Promise.all(changed.map((file) => exists(path.join(cwd, file))));
  return {
    files,
    changed,
    existing: changed.filter((_, index) => present[index]),
    packageDirs: await packageDirs(cwd, changed),
  };
}
