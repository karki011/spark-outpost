import { gitDiffBetween } from '../projects/snapshot.ts';
import { treeOf } from './land.ts';
import type { Session } from './session.ts';
import type { FlowAction } from './transitions.ts';

export function startsFixRound(
  s: Session,
  action: Extract<FlowAction, { type: 'spawn' }>,
): boolean {
  return (
    action.role === 'builder' &&
    action.reason === 'fix' &&
    s.flow.review.fixing &&
    s.fixRound !== s.flow.review.fixRounds
  );
}

export async function beginFixRound(s: Session): Promise<void> {
  s.fixRound = s.flow.review.fixRounds;
  const root = s.input.projectRoots[0];
  s.fixTree = root ? await treeOf(s, root) : null;
  s.fixPatch = null;
}

export async function fixDiff(s: Session): Promise<string | null> {
  const root = s.input.projectRoots[0];
  const from = s.fixTree;
  if (!root || !from) return null;
  const to = await treeOf(s, root);
  if (!to) return null;
  const diff = await gitDiffBetween(root, from, to).catch(() => null);
  return diff?.patch.trim() ? diff.patch : null;
}
