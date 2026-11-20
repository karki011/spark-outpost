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
  '.vite',
  '.mypy_cache',
  '.ruff_cache',
  '.wrangler',
  '.build',
  '.swiftpm',
  'test-results',
  'playwright-report',
  '.spark',
]);

const REGENERABLE_FILES: ReadonlySet<string> = new Set(['.DS_Store', '.eslintcache']);
const REGENERABLE_SUFFIXES = ['.log', '.tsbuildinfo'];

export function ignoredEntryMatters(entry: string): boolean {
  const isDir = entry.endsWith('/');
  const segments = entry.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  const dirs = isDir ? segments : segments.slice(0, -1);
  if (dirs.some((segment) => REGENERABLE_DIRS.has(segment))) return false;
  if (isDir) return true;
  const name = segments.at(-1)!;
  if (REGENERABLE_FILES.has(name)) return false;
  return !REGENERABLE_SUFFIXES.some((suffix) => name.endsWith(suffix));
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
  const entries = output.split('\0').filter(Boolean);
  const leaves = entries.filter(
    (entry) =>
      !entry.endsWith('/') || !entries.some((other) => other !== entry && other.startsWith(entry)),
  );
  return leaves.filter(ignoredEntryMatters).sort();
}
