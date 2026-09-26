import type { ChangedFile } from '@spark-outpost/contracts';

export const LARGE_DIFF_LINES = 800;
export const LARGE_DIFF_BYTES = 200 * 1024;

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

export type FileView =
  | { kind: 'text' }
  | { kind: 'binary' }
  | { kind: 'generated' }
  | { kind: 'large'; lines: number }
  | { kind: 'truncated'; lines: number | null };

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

function changedLines(file: ChangedFile): number | null {
  if (file.added === null || file.removed === null) return null;
  return file.added + file.removed;
}

function textBytes(file: ChangedFile): number {
  return (file.oldText?.length ?? 0) + (file.newText?.length ?? 0);
}

export function fileView(file: ChangedFile): FileView {
  if (file.shown === 'binary') return { kind: 'binary' };
  if (isGenerated(file.path)) return { kind: 'generated' };
  const lines = changedLines(file);
  if (file.shown === 'too-large') return { kind: 'truncated', lines };
  if ((lines ?? 0) > LARGE_DIFF_LINES || textBytes(file) > LARGE_DIFF_BYTES) {
    return { kind: 'large', lines: lines ?? 0 };
  }
  return { kind: 'text' };
}

export function changeTotals(files: readonly ChangedFile[]): ChangeTotals {
  return {
    files: files.length,
    added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
    removed: files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
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
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}
