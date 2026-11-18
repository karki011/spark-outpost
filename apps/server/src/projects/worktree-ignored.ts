import { git } from './snapshot.ts';

const REGENERABLE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.gradle',
  'DerivedData',
  '.parcel-cache',
  '.svelte-kit',
  '.spark',
]);

const REGENERABLE_FILES: ReadonlySet<string> = new Set(['.DS_Store']);

export function ignoredEntryMatters(entry: string): boolean {
  const isDir = entry.endsWith('/');
  const segments = entry.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  const dirs = isDir ? segments : segments.slice(0, -1);
  if (dirs.some((segment) => REGENERABLE_DIRS.has(segment))) return false;
  if (isDir) return true;
  const name = segments.at(-1)!;
  return !REGENERABLE_FILES.has(name) && !name.endsWith('.log');
}

export async function ignoredFilesThatMatter(worktree: string): Promise<string[]> {
  const output = await git(worktree, [
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
  ]);
  return output.split('\0').filter(Boolean).filter(ignoredEntryMatters).sort();
}
