import type { ModePosture } from '@spark-outpost/contracts';
import type { OwnedFiles } from '../coordinator/owned.ts';
import { commandTree } from './command-tree.ts';
import type { ApprovalRequest, Decision } from './decide.ts';
import { commandCwd } from './request-place.ts';
import type { ShellView } from './shell-view.ts';
import { writeTargets } from './write-targets.ts';

export const PIECE_CHECKED_WHY = "Spark saw no change outside this piece's files";

export function pieceUnclearReason(owned: OwnedFiles | null): string {
  const who = owned?.name ?? 'This piece';
  const others = owned?.others.length ?? 0;
  const sharing = others === 1 ? '1 other piece' : `${others} other pieces`;
  return `${who} shares this folder with ${sharing}, and Spark couldn't tell what this command changes`;
}

function writesKnown(request: ApprovalRequest, view: ShellView | null): boolean {
  if (!request.command) return false;
  if (view ? view.unparsed : commandTree(request.command).opaque) return false;
  if (view?.redirects.includes('writes_unknown')) return false;
  return writeTargets(request.command, commandCwd(request), request.home) !== null;
}

export function routedPieceDecision(
  posture: ModePosture,
  request: ApprovalRequest,
  view: ShellView | null,
  owned: OwnedFiles | null,
): Decision | null {
  if (posture !== 'auto') return null;
  if (request.kind === 'edit' || writesKnown(request, view)) {
    return { verdict: 'allow', by: 'level', why: PIECE_CHECKED_WHY };
  }
  return { verdict: 'ask', reason: null, because: pieceUnclearReason(owned) };
}
