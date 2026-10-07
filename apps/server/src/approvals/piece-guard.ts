import { z } from 'zod';
import { ownedFilesSchema, type OwnedFiles } from '../coordinator/owned.ts';
import { FULL_CHECKS_REASON, runsWholeProject } from '../coordinator/scoped-checks.ts';
import type { ApprovalRequest } from './decide.ts';
import { changesGitState } from './git-commands.ts';
import { scratchWorktree } from './git-worktrees.ts';
import { commandCwd } from './request-place.ts';
import { withResolvedVariables } from './shell-variables.ts';

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

export function pieceRefusal(asked: ApprovalRequest, guard: PieceGuard): string | null {
  const request = withResolvedVariables(asked);
  const command = request.command;
  const scratch = scratchWorktree(commandCwd(request), request.home);
  if (guard.coordinated && command && changesGitState(command, scratch)) return BUILDER_GIT_REASON;
  if (guard.owned && command && runsWholeProject(command)) {
    return `Inside a piece, ${FULL_CHECKS_REASON}`;
  }
  return null;
}
