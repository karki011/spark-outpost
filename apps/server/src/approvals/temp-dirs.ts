import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { relativeInside } from '../projects/path-policy.ts';

const FIXED_TEMP_ROOTS = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp'];
const TEMP_VARIABLE = /^\$(?:TMPDIR|\{TMPDIR\})(?=\/|$)/;

function realOrNull(target: string): string | null {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}

function realTarget(target: string): string {
  const missing: string[] = [];
  let existing = path.resolve(target);
  for (;;) {
    const real = realOrNull(existing);
    if (real !== null) return path.join(real, ...missing);
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(target);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
}

export function tempRoots(environment: NodeJS.ProcessEnv = process.env): string[] {
  const named = [...FIXED_TEMP_ROOTS, tmpdir(), environment.TMPDIR ?? ''].filter(
    (root) => path.isAbsolute(root) && path.resolve(root) !== path.parse(root).root,
  );
  const resolved = named.map((root) => path.resolve(root));
  const real = resolved.flatMap((root) => realOrNull(root) ?? []);
  return [...new Set([...resolved, ...real])];
}

export function inTempDir(target: string): boolean {
  const real = realTarget(target);
  return tempRoots().some((root) => relativeInside(root, real) !== null);
}

export function withTempVariable(word: string): string {
  return word.replace(TEMP_VARIABLE, tmpdir());
}
