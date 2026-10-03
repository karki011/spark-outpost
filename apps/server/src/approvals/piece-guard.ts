import { z } from 'zod';
import {
  ownedFilesSchema,
  ownerLabel,
  ownerOf,
  owns,
  type OwnedFiles,
} from '../coordinator/owned.ts';
import { FULL_CHECKS_REASON, runsWholeProject } from '../coordinator/scoped-checks.ts';
import type { ApprovalRequest } from './decide.ts';
import { changesGitState } from './git-commands.ts';
import { writeTargets } from './write-targets.ts';

export const BUILDER_GIT_REASON =
  "Builders in a coordinated task don't change the index, the branch or the stash; use `git diff` and `git show HEAD:<path>` for baselines";

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

function outsidePiece(owned: OwnedFiles, targets: readonly string[], relativeOf: RelativeOf) {
  for (const target of targets) {
    const relative = relativeOf(target);
    if (relative !== null && !owns(owned, relative)) return relative;
  }
  return null;
}

function commandTargets(request: ApprovalRequest): string[] {
  if (!request.command) return [];
  const cwd = request.cwd ?? request.roots[0]?.path ?? request.home;
  return writeTargets(request.command, cwd, request.home) ?? [];
}

export function pieceRefusal(
  request: ApprovalRequest,
  guard: PieceGuard,
  relativeOf: RelativeOf,
): string | null {
  const command = request.command;
  if (guard.coordinated && command && changesGitState(command)) return BUILDER_GIT_REASON;
  const owned = guard.owned;
  if (!owned) return null;
  if (command && runsWholeProject(command)) return `Inside a piece, ${FULL_CHECKS_REASON}`;
  const targets = request.kind === 'edit' ? request.paths : commandTargets(request);
  const outside = outsidePiece(owned, targets, relativeOf);
  return outside === null ? null : ownershipReason(owned, outside);
}
