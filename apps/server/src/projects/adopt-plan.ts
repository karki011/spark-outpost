import type { OpenPull } from '@spark-outpost/contracts';

export interface AdoptFacts {
  guarded: readonly string[];
  protectedOnHost: boolean;
  localBranch: boolean;
  checkedOut: boolean;
}

export type AdoptPlan =
  | { kind: 'head'; branch: string; fork: boolean; local: boolean }
  | { kind: 'based'; why: string }
  | { kind: 'busy'; why: string };

export const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export function forkRemoteName(owner: string): string {
  return `pr-${owner.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

function basedWhy(pull: OpenPull, reason: string): string {
  return `${reason}, so this chat works on its own spark/ branch based on @${pull.author}'s pull request #${pull.number} and can't push to ${pull.head}.`;
}

export function adoptPlan(pull: OpenPull, facts: AdoptFacts): AdoptPlan {
  if (!SAFE_BRANCH.test(pull.head) || pull.head.includes('..')) {
    return { kind: 'based', why: basedWhy(pull, `${pull.head} isn't a branch name Spark uses`) };
  }
  if (pull.fork && !pull.maintainerCanModify) {
    return {
      kind: 'based',
      why: basedWhy(
        pull,
        "The pull request comes from a fork that doesn't allow edits by maintainers",
      ),
    };
  }
  if (facts.guarded.includes(pull.head) || facts.protectedOnHost) {
    return { kind: 'based', why: basedWhy(pull, `${pull.head} is a protected branch`) };
  }
  if (pull.fork && facts.localBranch) {
    return {
      kind: 'based',
      why: basedWhy(pull, `A different local branch is already named ${pull.head}`),
    };
  }
  if (facts.checkedOut) {
    return {
      kind: 'busy',
      why: `${pull.head} is checked out in your checkout or another chat. Switch away from it first.`,
    };
  }
  return { kind: 'head', branch: pull.head, fork: pull.fork, local: facts.localBranch };
}

export function adoptedNote(
  pull: OpenPull,
  plan: Extract<AdoptPlan, { kind: 'head' }>,
  headOwner: string,
): string {
  const added = plan.fork
    ? ` Spark added the remote ${forkRemoteName(headOwner)} for the fork.`
    : '';
  return `This chat works on @${pull.author}'s pull request #${pull.number}, branch ${plan.branch}. Its agent may push to it, never force, and updates it by merging.${added}`;
}
