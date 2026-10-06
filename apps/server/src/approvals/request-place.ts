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
  if (relative === null || !root) return false;
  return isSecretPath(relative) && !isIgnoredPath(relative, root.ignore);
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

export function partPlace(request: ApprovalRequest): PartPlace {
  return {
    cwd: commandCwd(request),
    home: request.home,
    inside: (target) =>
      request.roots.some((root) => root.path === target) || !outsideRoots(request, target),
    isSecret: (target) => isSecretTarget(request.roots, target),
    readAsks: (target) => secretReadAsks(request.roots, target),
  };
}
