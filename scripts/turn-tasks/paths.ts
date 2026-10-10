import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const WORKTREE_ROOT = resolve(import.meta.dirname, '../..');
export const OUTPUT_ROOT = join(WORKTREE_ROOT, '.local', 'turn-tasks');
export const SCRATCH_FOLDER = 'spark-turn-tasks';

const OFF_LIMITS = [join(homedir(), 'Documents', 'feature-web-apps')];

function real(path: string): string[] {
  try {
    return [realpathSync(path)];
  } catch {
    return [];
  }
}

export function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

export function tempRoots(): string[] {
  return [...new Set([tmpdir(), '/private/tmp', '/tmp', '/var/tmp'].flatMap(real))];
}

export function scratchBase(): string {
  return join(realpathSync(tmpdir()), SCRATCH_FOLDER);
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
  if (OFF_LIMITS.some((root) => isInside(root, place))) {
    throw new Error(`${place} is off limits.`);
  }
  if (!tempRoots().some((root) => place !== root && isInside(root, place))) {
    throw new Error(`Scratch work must stay under a system temp folder, not ${place}.`);
  }
  return place;
}
