import { DIFF_HUGE_BYTES, DIFF_MAX_BYTES, type ChangeEntry } from '@spark-outpost/contracts';

type FileFacts = Pick<ChangeEntry, 'path' | 'shown' | 'added' | 'removed' | 'bytes'>;

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lockb',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'go.sum',
]);
const GENERATED_DIRS = new Set(['dist', 'build', 'out', 'coverage', 'node_modules', 'vendor']);
const GENERATED_NAME = /(\.lock|\.min\.(js|css|mjs)|\.bundle\.js|\.map|\.snap)$/i;

export type FileView = 'text' | 'binary' | 'generated' | 'huge' | 'oversized';

export interface ChangeTotals {
  files: number;
  added: number;
  removed: number;
}

export interface DiffStatBar {
  add: number;
  remove: number;
  empty: number;
}

export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) {
    const thousands = count / 1000;
    return `${thousands >= 100 ? Math.round(thousands) : trimZero(thousands.toFixed(1))}k`;
  }
  return `${trimZero((count / 1_000_000).toFixed(1))}M`;
}

function trimZero(value: string): string {
  return value.replace(/\.0$/, '');
}

export function formatLines(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'line' : 'lines'}`;
}

export function isGenerated(path: string): boolean {
  const parts = path.toLowerCase().split('/');
  const name = parts.at(-1) ?? '';
  if (LOCKFILES.has(name) || GENERATED_NAME.test(name)) return true;
  return parts.slice(0, -1).some((part) => GENERATED_DIRS.has(part));
}

export function fileView(file: FileFacts): FileView {
  if (file.shown === 'binary') return 'binary';
  const bytes = file.bytes ?? 0;
  if (bytes > DIFF_MAX_BYTES) return 'oversized';
  if (file.shown === 'too-large' || bytes > DIFF_HUGE_BYTES) return 'huge';
  return isGenerated(file.path) ? 'generated' : 'text';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${trimZero((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

export function formatTotal(count: number): string {
  return count < 100_000 ? count.toLocaleString('en-US') : formatCount(count);
}

export function runTotals(runs: readonly ChangeTotals[]): ChangeTotals {
  return {
    files: runs.reduce((sum, run) => sum + run.files, 0),
    added: runs.reduce((sum, run) => sum + run.added, 0),
    removed: runs.reduce((sum, run) => sum + run.removed, 0),
  };
}

export function diffStatBar(added: number, removed: number, slots = 5): DiffStatBar {
  const total = added + removed;
  if (total === 0) return { add: 0, remove: 0, empty: slots };
  const filled = Math.min(slots, total);
  let add = Math.round((added / total) * filled);
  if (added > 0 && add === 0) add = 1;
  if (removed > 0 && add === filled) add = filled - 1;
  return { add, remove: filled - add, empty: slots - filled };
}

export function filesLabel(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'file' : 'files'}`;
}
