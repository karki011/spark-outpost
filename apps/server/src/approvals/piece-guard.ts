import { z } from 'zod';
import {
  ownedFilesSchema,
  ownerLabel,
  ownerOf,
  owns,
  type OwnedFiles,
} from '../coordinator/owned.ts';
import { FULL_CHECKS_REASON, runsWholeProject } from '../coordinator/scoped-checks.ts';
import { isPackageInstall } from './command-kinds.ts';
import type { ApprovalRequest } from './decide.ts';
import { changesGitState } from './git-commands.ts';
import { scratchWorktree } from './git-worktrees.ts';
import { commandCwd } from './request-place.ts';
import { harmlessOutput, toolWriteTargets } from './tool-writes.ts';
import { writeTargets } from './write-targets.ts';

export const BUILDER_GIT_REASON =
  "Builders in a coordinated task don't change the index, the branch or the stash; use `git diff` and `git show HEAD:<path>` for baselines";

export const SHARED_INSTALL_REASON =
  'Other pieces are working in this folder at the same time, so installs wait until they land. Finish this piece without it and say in your reply which install it needs';

export interface PieceGuard {
  coordinated: boolean;
  owned: OwnedFiles | null;
  sharesTree?: boolean | undefined;
}

export const pieceGuardSchema = z.object({
  coordinated: z.boolean(),
  owned: ownedFilesSchema.nullable(),
  sharesTree: z.boolean().optional(),
});

export const builderEnvSchema = z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string());

export type RelativeOf = (target: string) => string | null;

const SHOWN_FILES = 4;

function ownList(owned: OwnedFiles): string {
  const all = [...owned.paths, ...owned.globs];
  const shown = all.slice(0, SHOWN_FILES).map((path) => `\`${path}\``);
  return all.length > SHOWN_FILES
    ? `${shown.join(', ')} and ${all.length - SHOWN_FILES} more`
    : shown.join(', ');
}

export function ownershipReason(owned: OwnedFiles, relative: string): string {
  const owner = ownerOf(owned, relative);
  const who = owner && owner !== owned ? `${ownerLabel(owner)} owns` : 'No piece owns';
  return `${who} \`${relative}\`; this piece (${ownerLabel(owned)}) owns ${ownList(owned)}; ask the coordinator in your reply if you need it changed`;
}

function scratchOutput(owned: OwnedFiles, relative: string): boolean {
  return harmlessOutput(relative) && ownerOf(owned, relative) === null;
}

function outsidePiece(owned: OwnedFiles, targets: readonly string[], relativeOf: RelativeOf) {
  for (const target of targets) {
    const relative = relativeOf(target);
    if (relative === null || owns(owned, relative)) continue;
    if (!scratchOutput(owned, relative)) return relative;
  }
  return null;
}

function rootOf(request: ApprovalRequest, target: string): boolean {
  return request.roots.some((root) => root.path === target);
}

function rewrittenByTools(request: ApprovalRequest): string[] {
  if (!request.command) return [];
  return toolWriteTargets(request.command, commandCwd(request), request.home);
}

function commandTargets(request: ApprovalRequest): string[] {
  if (!request.command) return [];
  const written = writeTargets(request.command, commandCwd(request), request.home) ?? [];
  return [...written, ...rewrittenByTools(request)];
}

export const WHOLE_TREE_REWRITE_REASON =
  "This rewrites files across the whole folder; name this piece's own files instead";

export function pieceRefusal(
  request: ApprovalRequest,
  guard: PieceGuard,
  relativeOf: RelativeOf,
): string | null {
  const command = request.command;
  const scratch = scratchWorktree(commandCwd(request), request.home);
  if (guard.coordinated && command && changesGitState(command, scratch)) return BUILDER_GIT_REASON;
  const owned = guard.owned;
  if (!owned) return null;
  if (command && guard.sharesTree && isPackageInstall(command)) return SHARED_INSTALL_REASON;
  if (command && runsWholeProject(command)) return `Inside a piece, ${FULL_CHECKS_REASON}`;
  if (rewrittenByTools(request).some((target) => rootOf(request, target))) {
    return WHOLE_TREE_REWRITE_REASON;
  }
  const targets = request.kind === 'edit' ? request.paths : commandTargets(request);
  const outside = outsidePiece(owned, targets, relativeOf);
  return outside === null ? null : ownershipReason(owned, outside);
}
