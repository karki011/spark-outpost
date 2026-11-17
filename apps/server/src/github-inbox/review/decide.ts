import type {
  GithubInboxItem,
  GithubInboxReviewSummary,
  GithubReviewPostKind,
  GithubReviewState,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowStep,
} from '@spark-outpost/contracts';
import type { StoredReviewSettings } from './settings.ts';

export const REVIEW_DEBOUNCE_MS = 2 * 60_000;

export const pullKeyOf = (pull: string) => pull.toLowerCase();

type Candidate = Pick<GithubInboxItem, 'id' | 'group' | 'draft' | 'authorIsBot' | 'headSha'>;

export function autoReviewWanted(
  item: Candidate,
  settings: StoredReviewSettings,
  reviewedHeads: ReadonlySet<string>,
): boolean {
  if (!settings.autoReview || !settings.reviewer) return false;
  if (item.group !== 'review_requested' || item.draft || item.authorIsBot) return false;
  return !reviewedHeads.has(item.headSha);
}

export function debouncedDue(now: Date): Date {
  return new Date(now.getTime() + REVIEW_DEBOUNCE_MS);
}

export interface LatestReview {
  state: GithubReviewState;
  headSha: string;
  posted: readonly GithubReviewPostKind[];
}

export function reviewSummary(
  latest: LatestReview | undefined,
  itemHeadSha: string,
): GithubInboxReviewSummary | null {
  if (!latest) return null;
  const posted = latest.posted.includes('approve')
    ? 'approve'
    : latest.posted.includes('comment')
      ? 'comment'
      : null;
  return {
    state: latest.state,
    headSha: latest.headSha,
    stale: latest.headSha !== itemHeadSha,
    posted,
  };
}

export const POST_ACTIONS = ['comment', 'approve', 'reply'] as const;
export type PostAction = (typeof POST_ACTIONS)[number];

export interface PostRequest {
  action: string;
  pull?: string | undefined;
  replyTo?: number | undefined;
}

export interface PostGrant {
  pull: string;
  state: GithubReviewState;
  stopping: boolean;
  mayPost: boolean;
  mayApprove: boolean;
}

export const POST_REFUSALS = {
  notReview: 'This tool works only in a pull request review run that Spark started.',
  finished: 'This review has finished or is stopping, so nothing more is posted.',
  noPost: 'Posting is off: the user has not turned on Reviewer may post to GitHub.',
  noApprove: 'Approving is off: the user has not turned on Reviewer may approve.',
  otherPull: 'This review run may post only on the pull request it was started for',
  action:
    'Only a review comment, an approval (when the user allows it) or a reply on this pull request’s review threads can be posted. Requesting changes, merging, pushing, dismissing and resolving are never allowed.',
  replyTo: 'A reply needs replyTo: the id of a review comment on this pull request.',
} as const;

const isPostAction = (action: string): action is PostAction =>
  (POST_ACTIONS as readonly string[]).includes(action);

export function postRefusal(request: PostRequest, grant: PostGrant | null): string | null {
  if (!grant) return POST_REFUSALS.notReview;
  if (grant.state !== 'running' || grant.stopping) return POST_REFUSALS.finished;
  if (!grant.mayPost) return POST_REFUSALS.noPost;
  if (request.pull !== undefined && pullKeyOf(request.pull) !== pullKeyOf(grant.pull)) {
    return `${POST_REFUSALS.otherPull} (${grant.pull}).`;
  }
  if (!isPostAction(request.action)) return POST_REFUSALS.action;
  if (request.action === 'approve' && !grant.mayApprove) return POST_REFUSALS.noApprove;
  if (request.action === 'reply' && request.replyTo === undefined) return POST_REFUSALS.replyTo;
  return null;
}

export const NO_REPLY = 'The reviewer finished without a reply.';
export const WORKFLOW_FAILED = 'The review stopped because a step failed.';
export const OUTCOME_UNKNOWN = 'The review’s outcome is unknown: Spark stopped while it ran.';

export interface ReviewEnd {
  state: Extract<GithubReviewState, 'done' | 'failed' | 'stopped'>;
  body: string | null;
  error: string | null;
}

function sinkSteps(steps: readonly Pick<WorkflowStep, 'id' | 'dependsOn'>[]): Set<string> {
  const parents = new Set(steps.flatMap((step) => step.dependsOn));
  return new Set(steps.filter((step) => !parents.has(step.id)).map((step) => step.id));
}

export function reviewEnd(
  status: Exclude<WorkflowRunStatus, 'running'>,
  definition: readonly Pick<WorkflowStep, 'id' | 'dependsOn'>[],
  steps: readonly Pick<WorkflowRunStep, 'stepId' | 'state' | 'note'>[],
  stopRequested: boolean,
): ReviewEnd {
  if (status === 'cancelled' || stopRequested) {
    return { state: 'stopped', body: null, error: null };
  }
  if (status === 'outcome_unknown') return { state: 'failed', body: null, error: OUTCOME_UNKNOWN };
  if (status === 'failed') {
    const failed = steps.find((step) => step.state === 'failed')?.note?.trim();
    return { state: 'failed', body: null, error: (failed || WORKFLOW_FAILED).slice(0, 2000) };
  }
  const sinks = sinkSteps(definition);
  const replies = steps
    .filter((step) => sinks.has(step.stepId) && step.state === 'succeeded')
    .map((step) => step.note?.trim() ?? '')
    .filter((note) => note.length > 0);
  if (replies.length === 0) return { state: 'failed', body: null, error: NO_REPLY };
  return { state: 'done', body: replies.join('\n\n---\n\n'), error: null };
}
