import type { GithubInboxGroup, GithubInboxItem } from '@spark-outpost/contracts';
import { cleanReview } from '../pr-tracking/clean.ts';
import type { SeenMark } from '../persistence/github-inbox.ts';
import type { FoundPull } from './search.ts';

export type InboxPull = Omit<
  GithubInboxItem,
  'projectId' | 'conversationId' | 'ticket' | 'unseen' | 'updatedSinceSeen' | 'review'
>;

interface PullState {
  draft: boolean;
  checks: FoundPull['checks'];
  headSha: string;
  conflict: boolean;
  behind: boolean;
  changesRequested: boolean;
  openThreads: number | null;
  reviewDecision: string | null;
}

function inboxGroup(state: PullState, mine: boolean): GithubInboxGroup {
  if (!mine) return 'review_requested';
  if (state.draft) return 'waiting';
  const unresolvedThreads = (state.openThreads ?? 0) > 0;
  if (
    state.checks === 'failing' ||
    state.changesRequested ||
    unresolvedThreads ||
    state.conflict ||
    state.behind
  ) {
    return 'needs_fixes';
  }
  const clean = cleanReview({
    draft: state.draft,
    headSha: state.headSha,
    checks: state.checks,
    changesRequested: state.changesRequested,
    unresolvedThreads,
  });
  return clean && state.reviewDecision !== 'REVIEW_REQUIRED' ? 'ready_to_merge' : 'waiting';
}

const sameLogin = (a: string, b: string | null) =>
  b !== null && a.toLowerCase() === b.toLowerCase();

export function inboxPull(found: FoundPull, viewer: string | null): InboxPull | null {
  const mine = sameLogin(found.author, viewer);
  if (!mine && !found.reviewRequested) return null;
  const changesRequested =
    found.reviewDecision === 'CHANGES_REQUESTED' ||
    found.reviews.some((review) => review.state === 'CHANGES_REQUESTED');
  const state: PullState = {
    draft: found.draft,
    checks: found.checks,
    headSha: found.headSha,
    conflict: found.mergeable === 'CONFLICTING' || found.mergeState === 'DIRTY',
    behind: found.mergeState === 'BEHIND',
    changesRequested,
    openThreads: found.unresolvedThreads,
    reviewDecision: found.reviewDecision,
  };
  return {
    id: `${found.repo}#${found.number}`,
    url: found.url,
    repo: found.repo,
    number: found.number,
    title: found.title,
    author: found.author,
    authorIsBot: found.authorIsBot,
    mine,
    group: inboxGroup(state, mine),
    draft: found.draft,
    checks: found.checks,
    failingChecks: found.failingChecks,
    conflict: state.conflict,
    behind: state.behind,
    openThreads: found.unresolvedThreads,
    changesRequested,
    approvedBy: found.reviews
      .filter((review) => review.state === 'APPROVED')
      .map((review) => review.login),
    waitingOn: found.requestedReviewers,
    headSha: found.headSha,
    updatedAt: found.updatedAt,
    createdAt: found.createdAt,
    headRef: found.headRef,
    baseRef: found.baseRef,
    labels: found.labels,
    assignees: found.assignees,
    comments: found.comments,
    bodyPreview: found.bodyPreview,
    additions: found.additions,
    deletions: found.deletions,
    changedFiles: found.changedFiles,
  };
}

export function inboxPulls(found: readonly FoundPull[], viewer: string | null): InboxPull[] {
  const byId = new Map<string, InboxPull>();
  for (const candidate of found) {
    const pull = inboxPull(candidate, viewer);
    if (!pull) continue;
    const known = byId.get(pull.id);
    if (!known || (pull.mine && !known.mine)) byId.set(pull.id, pull);
  }
  return [...byId.values()];
}

export function seenFlags(
  group: GithubInboxGroup,
  headSha: string,
  mark: SeenMark | undefined,
): Pick<GithubInboxItem, 'unseen' | 'updatedSinceSeen'> {
  return {
    unseen: group === 'review_requested' && mark === undefined,
    updatedSinceSeen: mark !== undefined && mark.headSha !== headSha,
  };
}
