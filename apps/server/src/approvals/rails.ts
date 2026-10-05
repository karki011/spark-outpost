import path from 'node:path';
import { isSecretPath } from '../projects/path-policy.ts';
import { commandTree, deleteTargets, treeWords, type CommandTree } from './command-tree.ts';
import { resolveCommandPath } from './commands.ts';
import type { ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { readConcern } from './file-reads.ts';
import { worktreeAdds, worktreeRemoves } from './git-worktrees.ts';
import { commandCwd, isSecretTarget, outsideRoots } from './request-place.ts';
import { partRequests, type ShellView } from './shell-view.ts';
import { inTempDir } from './temp-dirs.ts';
import { writeTargets } from './write-targets.ts';

export const OUTSIDE_DELETE_REASON = 'Deleting outside the repo always asks';
export const OUTSIDE_WRITE_REASON = 'Changing files outside the repo always asks';
export const SECRET_REASON = 'Secret files always ask';

export interface RailAsk {
  rail: 'outside_delete' | 'outside_write' | 'secret';
  reason: string;
  paths: string[];
}

const SHOWN_PATHS = 2;

function shown(target: string, home: string): string {
  const inHome = path.relative(home, target);
  const underHome = inHome !== '' && !inHome.startsWith('..') && !path.isAbsolute(inHome);
  return underHome ? `~/${inHome}` : target;
}

function listed(paths: readonly string[], home: string): string {
  const names = paths.slice(0, SHOWN_PATHS).map((target) => shown(target, home));
  const more = paths.length - names.length;
  return more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ');
}

export function outsideDeleteReason(paths: readonly string[], home: string): string {
  return `This deletes ${listed(paths, home)}, which is outside this project`;
}

export function outsideWriteReason(paths: readonly string[], home: string): string {
  return `This changes ${listed(paths, home)}, which is outside this project`;
}

function leavesProject(request: ApprovalRequest, target: string): boolean {
  return outsideRoots(request, target) && !inTempDir(target);
}

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function outsideDeletes(request: ApprovalRequest, tree: CommandTree | null): string[] | null {
  const named = request.toolKind === 'delete' ? request.paths : [];
  if (!tree || !request.command) return named.filter((target) => leavesProject(request, target));
  const cwd = commandCwd(request);
  const deleted = deleteTargets(tree, cwd, request.home);
  const removed = worktreeRemoves(request.command, cwd, request.home);
  if (deleted === null || removed === null) return null;
  return unique([...named, ...deleted, ...removed]).filter((target) =>
    leavesProject(request, target),
  );
}

function outsideWrites(request: ApprovalRequest): string[] | null {
  if (!request.command) return [];
  const cwd = commandCwd(request);
  const added = worktreeAdds(request.command, cwd, request.home);
  if (added === null) return null;
  const written = writeTargets(request.command, cwd, request.home) ?? [];
  return unique([...written, ...added]).filter((target) => leavesProject(request, target));
}

function touchesSecret(request: ApprovalRequest, tree: CommandTree | null): boolean {
  if (request.paths.some((target) => isSecretTarget(request.roots, target))) return true;
  if (!tree) return false;
  const cwd = commandCwd(request);
  return treeWords(tree)
    .filter((word) => word !== '' && !word.startsWith('-'))
    .some((word) => {
      if (isSecretPath(path.basename(word))) return true;
      return isSecretTarget(request.roots, resolveCommandPath(word, cwd, request.home));
    });
}

function readsSecret(request: ApprovalRequest, tree: CommandTree | null, files: FileLister) {
  if (!request.command || !tree) return false;
  const concern = readConcern(request.command, tree, {
    cwd: commandCwd(request),
    home: request.home,
    isSecret: (target) => isSecretTarget(request.roots, target),
    files,
  });
  return concern === 'secret';
}

const SECRET_ASK: RailAsk = { rail: 'secret', reason: SECRET_REASON, paths: [] };

function commandRail(request: ApprovalRequest, files: FileLister): RailAsk | null {
  const tree = request.command ? commandTree(request.command) : null;
  const deleted = outsideDeletes(request, tree);
  if (deleted === null) return { rail: 'outside_delete', reason: OUTSIDE_DELETE_REASON, paths: [] };
  if (deleted.length > 0) {
    const reason = outsideDeleteReason(deleted, request.home);
    return { rail: 'outside_delete', reason, paths: deleted };
  }
  if (touchesSecret(request, tree) || readsSecret(request, tree, files)) return SECRET_ASK;
  const written = outsideWrites(request);
  if (written === null) return { rail: 'outside_write', reason: OUTSIDE_WRITE_REASON, paths: [] };
  if (written.length === 0) return null;
  const reason = outsideWriteReason(written, request.home);
  return { rail: 'outside_write', reason, paths: written };
}

function redirectRail(view: ShellView | null): RailAsk | null {
  const kinds = view?.redirects ?? [];
  if (kinds.includes('secret')) return SECRET_ASK;
  if (!kinds.includes('writes_outside')) return null;
  return { rail: 'outside_write', reason: OUTSIDE_WRITE_REASON, paths: [] };
}

function editRail(request: ApprovalRequest): RailAsk | null {
  if (request.kind !== 'edit' && request.toolKind !== 'move') return null;
  const outside = request.paths.filter((target) => leavesProject(request, target));
  if (outside.length === 0) return null;
  const reason = outsideWriteReason(outside, request.home);
  return { rail: 'outside_write', reason, paths: outside };
}

export function alwaysAsk(
  request: ApprovalRequest,
  files: FileLister,
  view: ShellView | null,
): RailAsk | null {
  const parts = view ? [request, ...partRequests(request, view)] : [request];
  for (const part of parts) {
    const asked = commandRail(part, files);
    if (asked) return asked;
  }
  return redirectRail(view) ?? editRail(request);
}
