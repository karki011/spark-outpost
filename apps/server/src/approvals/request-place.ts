import path from 'node:path';
import { isIgnoredPath, isSecretPath, relativeInside } from '../projects/path-policy.ts';
import type { ApprovalRequest, RequestRoot } from './decide.ts';
import type { PartPlace } from './shell-parts.ts';

interface Placement {
  relative: string | null;
  root: RequestRoot | null;
}

export function place(roots: readonly RequestRoot[], target: string): Placement {
  let best: Placement = { relative: null, root: null };
  for (const root of roots) {
    const relative = relativeInside(root.path, target);
    if (relative === null) continue;
    if (!best.root || root.path.length > best.root.path.length) best = { relative, root };
  }
  return best;
}

export function isSecretTarget(roots: readonly RequestRoot[], target: string): boolean {
  const { relative, root } = place(roots, target);
  if (relative !== null && root) return isSecretPath(relative, root.ignore);
  return isSecretPath(path.basename(target));
}

export function isReadableSecret(roots: readonly RequestRoot[], target: string): boolean {
  const { relative, root } = place(roots, target);
  if (relative === null || !root) return isSecretPath(path.basename(target));
  return isSecretPath(relative) && !isIgnoredPath(relative, root.ignore);
}

export function homeRelative(target: string, home: string): string {
  const inHome = path.relative(home, target);
  const underHome = inHome !== '' && !inHome.startsWith('..') && !path.isAbsolute(inHome);
  return underHome ? `~/${inHome}` : target;
}

export function placedLabel(roots: readonly RequestRoot[], home: string, target: string): string {
  return place(roots, target).relative ?? homeRelative(target, home);
}

export function secretReadAsks(roots: readonly RequestRoot[], target: string): boolean {
  return isSecretTarget(roots, target) && !isReadableSecret(roots, target);
}

export function commandCwd(request: ApprovalRequest): string {
  return request.cwd ?? request.roots[0]?.path ?? request.home;
}

export function outsideRoots(request: ApprovalRequest, target: string): boolean {
  return place(request.roots, target).relative === null;
}

function inReadable(folders: readonly string[], target: string): boolean {
  return folders.some(
    (folder) => path.resolve(folder) === target || relativeInside(folder, target) !== null,
  );
}

export function partPlace(request: ApprovalRequest): PartPlace {
  return {
    cwd: commandCwd(request),
    home: request.home,
    inside: (target) =>
      request.roots.some((root) => root.path === target) ||
      !outsideRoots(request, target) ||
      inReadable(request.readable ?? [], target),
    isSecret: (target) => isSecretTarget(request.roots, target),
    readAsks: (target) => secretReadAsks(request.roots, target),
  };
}
