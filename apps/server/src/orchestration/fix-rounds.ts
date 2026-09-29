import { gitChanges, revertGitChanges } from '../projects/snapshot.ts';
import { runEvents } from '../workflow/run-events.ts';
import { budgetUsage } from './budget-check.ts';
import { checksFailing } from './check-results.ts';
import { treeOf } from './land.ts';
import type { Session } from './session.ts';
import type { FlowAction, FlowEvent } from './transitions.ts';

export function startsFixRound(
  s: Session,
  action: Extract<FlowAction, { type: 'spawn' }>,
): boolean {
  return (
    action.role === 'builder' &&
    action.reason === 'fix' &&
    s.flow.review.fixing &&
    s.fixRound?.round !== s.flow.review.fixRounds
  );
}

export async function beginFixRound(s: Session): Promise<void> {
  const usage = await budgetUsage(s);
  s.fixRound = {
    round: s.flow.review.fixRounds,
    toolCallsAt: usage.toolCalls,
    activeMsAt: usage.activeMs,
    hit: null,
  };
  if (checksFailing(s)) s.passing = null;
  else await notePassing(s);
}

export async function notePassing(s: Session): Promise<void> {
  const root = s.input.projectRoots[0];
  const tree = root ? await treeOf(s, root) : null;
  s.passing = tree
    ? { tree, checkBodies: [...s.checkBodies], checkLines: [...s.checkLines] }
    : null;
}

export function cutFacts(s: Session): { round?: boolean; passing?: boolean } {
  if (!s.flow.review.fixing) return {};
  return {
    ...(s.fixRound?.hit ? { round: true } : {}),
    ...(s.passing ? { passing: true } : {}),
  };
}

export async function restoreAfterCut(s: Session): Promise<FlowEvent> {
  const root = s.input.projectRoots[0];
  const passing = s.passing;
  let restored = false;
  if (root && passing) {
    try {
      const current = await treeOf(s, root);
      if (current && current !== passing.tree) {
        await revertGitChanges(root, passing.tree, await gitChanges(root, passing.tree, current));
        restored = true;
      }
      s.checkBodies = [...passing.checkBodies];
      s.checkLines = [...passing.checkLines];
    } catch (error) {
      console.error('Could not restore the last passing state', error);
    }
  }
  if (s.fixRound?.hit) s.budgetHit = null;
  s.fixRound = null;
  const note = restored
    ? 'Fix round cut short: rolled back to the last state that passed the checks'
    : 'Fix round cut short: kept the last state that passed the checks';
  await s.append(runEvents.stepStarted(note));
  await s.append(runEvents.stepFinished(note));
  return { type: 'restored', restored };
}
