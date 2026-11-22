import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nativePath from 'node:path';
import { gatePaths as path, gateRelativeInside, nativeOrNull, toGatePath } from './gate-path.ts';

const FIXED_TEMP_ROOTS = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp'];
const TEMP_VARIABLE = /^\$(?:TMPDIR|\{TMPDIR\})(?=\/|$)/;

function volumeRoot(native: string): boolean {
  const paths = process.platform === 'win32' ? nativePath.win32 : nativePath.posix;
  if (!paths.isAbsolute(native)) return false;
  const resolved = paths.resolve(native);
  return resolved === paths.parse(resolved).root;
}

function systemTemp(): string {
  return toGatePath(tmpdir());
}

function realOrNull(target: string): string | null {
  const native = nativeOrNull(target);
  if (native === null) return null;
  try {
    return toGatePath(realpathSync.native(native));
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
  const variable = environment.TMPDIR ?? '';
  const fromVariable = volumeRoot(variable) ? [] : [toGatePath(variable)];
  const system = volumeRoot(tmpdir()) ? [] : [systemTemp()];
  const named = [...FIXED_TEMP_ROOTS, ...system, ...fromVariable].filter(
    (root) => path.isAbsolute(root) && path.resolve(root) !== path.parse(root).root,
  );
  const resolved = named.map((root) => path.resolve(root));
  const real = resolved.flatMap((root) => realOrNull(root) ?? []);
  return [...new Set([...resolved, ...real])];
}

export function inTempDir(target: string): boolean {
  const real = realTarget(target);
  return tempRoots().some((root) => gateRelativeInside(root, real) !== null);
}

export function withTempVariable(word: string): string {
  return word.replace(TEMP_VARIABLE, systemTemp());
}
