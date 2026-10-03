import type { RailKind } from '@spark-outpost/contracts';
import { commandTree, deleteTargets } from './command-tree.ts';
import {
  alwaysAskReason,
  guardedTargets,
  OUTSIDE_DELETE_REASON,
  OUTSIDE_WRITE_REASON,
  SECRET_REASON,
  secretLabels,
  type ApprovalRequest,
} from './decide.ts';
import { diskFiles, type FileLister } from './file-lister.ts';
import { withPrefetchedFiles } from './prefetched-files.ts';
import { forcePush } from './git-commands.ts';
import { commandCwd, inTempDir, outsideRoots } from './request-place.ts';
import type { ShellScript } from './shell-parse.ts';
import { partRequests, shellView, type ShellView } from './shell-view.ts';
import { writeTargets } from './write-targets.ts';

export interface RailCrossing {
  rail: RailKind;
  paths: string[];
}

export interface CrossingOptions {
  shell?: ShellScript | null;
  defaultBranch?: string | null;
  files?: FileLister;
}

const REASON_RAILS = new Map<string, RailKind>([
  [OUTSIDE_DELETE_REASON, 'outside_delete'],
  [OUTSIDE_WRITE_REASON, 'outside_write'],
  [SECRET_REASON, 'secret'],
]);

function writesOf(request: ApprovalRequest): string[] {
  if (request.kind === 'edit' || request.toolKind === 'move') return request.paths;
  if (!request.command) return [];
  return writeTargets(request.command, commandCwd(request), request.home) ?? [];
}

function deletesOf(request: ApprovalRequest): string[] {
  if (request.toolKind === 'delete') return request.paths;
  if (!request.command) return [];
  return deleteTargets(commandTree(request.command), commandCwd(request), request.home) ?? [];
}

function outside(requests: readonly ApprovalRequest[], pick: (r: ApprovalRequest) => string[]) {
  const found = requests.flatMap((request) =>
    pick(request).filter((target) => outsideRoots(request, target) && !inTempDir(target)),
  );
  return [...new Set(found)];
}

function pathsFor(rail: RailKind, request: ApprovalRequest, parts: ApprovalRequest[]): string[] {
  if (rail === 'outside_write') return outside([request, ...parts], writesOf);
  if (rail === 'outside_delete') return outside([request, ...parts], deletesOf);
  return secretLabels(request);
}

async function askReason(
  request: ApprovalRequest,
  options: CrossingOptions,
  view: ShellView | null,
): Promise<string | null> {
  if (options.files) return alwaysAskReason(request, options.files, view);
  return withPrefetchedFiles(diskFiles, (files) => alwaysAskReason(request, files, view), null);
}

async function reasonCrossing(
  request: ApprovalRequest,
  options: CrossingOptions,
): Promise<RailCrossing | null> {
  const view = shellView(request, options.shell ?? null);
  const reason = await askReason(request, options, view);
  const rail = reason ? REASON_RAILS.get(reason) : undefined;
  if (!rail) return null;
  const paths = pathsFor(rail, request, partRequests(request, view));
  const onlyTemp = paths.length === 0 && request.kind === 'edit' && rail !== 'secret';
  return onlyTemp ? null : { rail, paths };
}

export async function railCrossings(
  request: ApprovalRequest,
  options: CrossingOptions = {},
): Promise<RailCrossing[]> {
  const crossings: RailCrossing[] = [];
  const reasoned = await reasonCrossing(request, options);
  if (reasoned) crossings.push(reasoned);
  const guarded = guardedTargets(request);
  if (guarded.instructions.length > 0) {
    crossings.push({ rail: 'instructions', paths: guarded.instructions });
  }
  if (guarded.gitControl.length > 0) {
    crossings.push({ rail: 'git_control', paths: guarded.gitControl });
  }
  const forced = request.command ? forcePush(request.command, options.defaultBranch ?? null) : null;
  if (forced) {
    crossings.push({ rail: 'force_push', paths: forced.kind === 'ask' ? forced.branches : [] });
  }
  return crossings;
}
