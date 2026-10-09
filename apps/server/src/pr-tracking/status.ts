import type { PrPollProblem } from '@spark-outpost/contracts';
import type { TrackedPull } from '../persistence/tracked-pulls.ts';
import { TRACKING_LINE, WATCHING_LINE } from '../persistence/tracked-pulls.ts';
import { readCheckSummary, readPullFacts, type PullFacts } from '../pr-follow-up/gather.ts';
import { reviewVerdict } from '../tickets/pull-status.ts';
import { discussionDetails, readDiscussion } from './details.ts';
import { GitHubApiError, type GitHubConnection } from '../ship/github/connection.ts';

export class PullAccessError extends Error {}

const NO_ACCESS_STATUSES = new Set([401, 403, 404]);
const RATE_LIMITED = 429;

export function notConnectedReason(host: string): string {
  return `GitHub is not connected for ${host}, so Spark can’t read this pull request. Connect GitHub in Settings.`;
}

export function accessReason(pull: Pick<TrackedPull, 'owner' | 'repo'>, error: unknown) {
  if (error instanceof PullAccessError) return error.message;
  if (error instanceof GitHubApiError && NO_ACCESS_STATUSES.has(error.status)) {
    return `Your GitHub connection can’t read ${pull.owner}/${pull.repo} (${error.status}). Give it access to this repository to see checks and reviews.`;
  }
  return null;
}

export const isRateLimited = (error: unknown) =>
  error instanceof GitHubApiError && error.status === RATE_LIMITED;

const isUnreachable = (error: unknown) => error instanceof TypeError && error.cause !== undefined;

export function pollProblemOf(error: unknown): PrPollProblem {
  if (error instanceof PullAccessError) return 'not_connected';
  if (isRateLimited(error)) return 'rate_limit';
  if (error instanceof GitHubApiError && NO_ACCESS_STATUSES.has(error.status)) return 'no_access';
  return isUnreachable(error) ? 'offline' : 'error';
}

const CLOSED_LINE = 'The PR was closed. Spark picks it up again if it is reopened.';

export function endedPull<T extends TrackedPull>(pull: T, state: 'merged' | 'closed'): T {
  const verb = pull.followUp ? 'watching' : 'tracking';
  return {
    ...pull,
    prState: state,
    phase: 'done',
    doing: state === 'closed' ? CLOSED_LINE : `The PR was merged. Spark stopped ${verb} it.`,
  };
}

export function reopenedPull<T extends TrackedPull>(pull: T): T {
  if (pull.prState === 'open') return pull;
  return {
    ...pull,
    prState: 'open',
    phase: 'watching',
    doing: pull.followUp ? WATCHING_LINE : TRACKING_LINE,
  };
}

export function withFacts<T extends TrackedPull>(pull: T, facts: PullFacts): T {
  const head = facts.head ?? pull.branch;
  return {
    ...pull,
    draft: facts.draft,
    headSha: facts.headSha,
    title: facts.title ?? pull.title,
    base: facts.base ?? pull.base,
    additions: facts.additions ?? pull.additions,
    deletions: facts.deletions ?? pull.deletions,
    branch: head,
    followUp: pull.followUp && head === pull.branch,
    statusReason: null,
  };
}

const repoOf = (pull: TrackedPull) => ({ owner: pull.owner, name: pull.repo });

export function statusChanged(before: TrackedPull, after: TrackedPull): boolean {
  return (
    before.checks !== after.checks ||
    before.review !== after.review ||
    before.draft !== after.draft ||
    before.headSha !== after.headSha
  );
}

export async function readFacts(
  connection: GitHubConnection | null,
  pull: TrackedPull,
): Promise<{ connection: GitHubConnection; facts: PullFacts }> {
  if (!connection) throw new PullAccessError(notConnectedReason(pull.host));
  return { connection, facts: await readPullFacts(connection, repoOf(pull), pull.number) };
}

export async function trackOpenPull(
  connection: GitHubConnection,
  seen: TrackedPull,
): Promise<TrackedPull> {
  const [checks, discussion] = await Promise.all([
    readCheckSummary(connection, repoOf(seen), seen.headSha!),
    readDiscussion(connection, repoOf(seen), seen.number),
  ]);
  const review = reviewVerdict(
    discussion.reviews.map((entry) => ({ user: entry.user?.login ?? 'ghost', state: entry.state })),
  );
  return {
    ...seen,
    checks: checks.state,
    failingChecks: checks.failingChecks,
    details: {
      checkRuns: checks.checkRuns,
      ...(await discussionDetails(connection, repoOf(seen), seen.number, discussion)),
    },
    review,
    phase: 'watching',
    doing: TRACKING_LINE,
  };
}
