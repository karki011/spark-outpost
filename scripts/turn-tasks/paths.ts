import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const WORKTREE_ROOT = resolve(import.meta.dirname, '../..');
export const OUTPUT_ROOT = join(WORKTREE_ROOT, '.local', 'turn-tasks');
export const SCRATCH_FOLDER = 'spark-turn-tasks';

function real(path: string): string[] {
  try {
    return [process.platform === 'win32' ? realpathSync.native(path) : realpathSync(path)];
  } catch {
    return [];
  }
}

function comparable(path: string): string {
  return process.platform === 'win32' ? path.replaceAll('\\', '/').toLowerCase() : path;
}

export function isInside(parent: string, child: string): boolean {
  const [outer, inner] = [comparable(parent), comparable(child)];
  return inner === outer || inner.startsWith(`${outer}/`);
}

export function tempRoots(): string[] {
  return [...new Set([tmpdir(), '/private/tmp', '/tmp', '/var/tmp'].flatMap(real))];
}

export function scratchBase(): string {
  return join(real(tmpdir())[0] ?? tmpdir(), SCRATCH_FOLDER);
}

function located(path: string): string {
  const missing: string[] = [];
  let existing = resolve(path);
  while (real(existing).length === 0 && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(real(existing)[0] ?? existing, ...missing);
}

export function assertScratchPath(path: string): string {
  const place = located(path);
  if (
    !tempRoots().some((root) => comparable(place) !== comparable(root) && isInside(root, place))
  ) {
    throw new Error(`Scratch work must stay under a system temp folder, not ${place}.`);
  }
  return place;
}
