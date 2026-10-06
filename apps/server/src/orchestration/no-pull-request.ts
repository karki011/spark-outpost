import { KEPT_BY_AUTO_EDIT } from './checkpoint-policy.ts';
import { sessionReviewLine } from './critic-fix.ts';
import { autoKeep, publishWhenAsked } from './full-auto-ship.ts';
import type { Session } from './session.ts';
import type { FlowEvent } from './transitions.ts';

export const NO_PULL_REQUEST = {
  noProject: 'No pull request: this chat has no project.',
  notGit: 'No pull request: this project isn’t a git repository.',
};

export interface PullRequestFacts {
  hasProject: boolean;
  git: boolean;
}

export function noPullRequestLine(facts: PullRequestFacts): string | null {
  if (!facts.hasProject) return NO_PULL_REQUEST.noProject;
  if (!facts.git) return NO_PULL_REQUEST.notGit;
  return null;
}

export async function keepWithoutPullRequest(
  s: Session,
  keptNote: string | null,
): Promise<FlowEvent | null> {
  const line = noPullRequestLine({ hasProject: s.input.projectRoots.length > 0, git: s.git });
  if (line === null) return null;
  s.shipLine = line;
  await autoKeep(s, 'hands-off', [keptNote ?? KEPT_BY_AUTO_EDIT, sessionReviewLine(s), line]);
  await publishWhenAsked(s);
  return { type: 'kept' };
}
