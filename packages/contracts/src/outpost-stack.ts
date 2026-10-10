import type { PrBase, StackFacts, StackWarnings } from './outpost-story.ts';
import type { StackWarning } from './outposts.ts';

function parentPullEnded(facts: StackFacts): boolean {
  return facts.parentPull !== null && facts.parentPull.state !== 'open';
}

export const prBase: PrBase = (facts) => {
  if (facts.parentBranch === null || parentPullEnded(facts)) return facts.defaultBranch;
  return facts.parentBranch;
};

function parentFailed(facts: StackFacts): StackWarning | null {
  const parent = `@${facts.parentHandle}`;
  if (facts.parentState === 'failed') return { kind: 'parent_failed', text: `${parent} failed` };
  if (facts.parentState === 'cancelled') {
    return { kind: 'parent_failed', text: `${parent} was cancelled` };
  }
  return null;
}

function parentNotPushed(facts: StackFacts): StackWarning | null {
  if (facts.parentOnRemote) return null;
  return {
    kind: 'parent_not_pushed',
    text: `@${facts.parentHandle}'s branch is not pushed, so @${facts.handle} cannot push`,
  };
}

function behindParent(facts: StackFacts): StackWarning | null {
  if (facts.branch === null || facts.parentInBranch !== false) return null;
  return {
    kind: 'behind_parent',
    text: `@${facts.parentHandle} has commits that @${facts.handle} does not have`,
  };
}

function baseMerged(facts: StackFacts, pullBase: string): StackWarning | null {
  if (!parentPullEnded(facts) || pullBase !== facts.parentBranch) return null;
  const trap = `Merging this now would not reach ${facts.defaultBranch}`;
  if (facts.parentPull?.state === 'merged') return { kind: 'base_merged', text: trap };
  return {
    kind: 'base_merged',
    text: `@${facts.parentHandle}'s pull request was closed. ${trap}`,
  };
}

function baseWarning(facts: StackFacts): StackWarning | null {
  const pullBase = facts.pull?.base ?? null;
  if (pullBase === null) return null;
  const expected = prBase(facts);
  if (pullBase === expected) return null;
  return (
    baseMerged(facts, pullBase) ?? {
      kind: 'base_mismatch',
      text: `The pull request targets ${pullBase}, not ${expected}`,
    }
  );
}

function liveStackWarnings(facts: StackFacts): (StackWarning | null)[] {
  if (prBase(facts) !== facts.parentBranch) return [];
  return [parentNotPushed(facts), behindParent(facts)];
}

export const stackWarnings: StackWarnings = (facts) => {
  if (facts.pull !== null && facts.pull.state !== 'open') return [];
  return [parentFailed(facts), ...liveStackWarnings(facts), baseWarning(facts)].filter(
    (warning) => warning !== null,
  );
};
