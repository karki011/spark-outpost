import type { PullRequestState, PullRequestStatus } from '@spark-outpost/contracts';
import { connectionFor, type GitHubDeps } from '../ship/github/access.ts';
import type { GitHubConnection, PullRequestDetail } from '../ship/github/connection.ts';

const PULL_URL = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export interface PullAddress {
  host: string;
  owner: string;
  name: string;
  number: number;
}

export function parsePullUrl(url: string): PullAddress | null {
  const match = PULL_URL.exec(url.trim());
  if (!match) return null;
  return { host: match[1]!, owner: match[2]!, name: match[3]!, number: Number(match[4]) };
}

function latestReviewStates(reviews: PullRequestDetail['reviews']): string[] {
  const byUser = new Map<string, string>();
  for (const review of reviews) {
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    byUser.set(review.user, review.state);
  }
  return [...byUser.values()];
}

export function pullRequestState(pull: PullRequestDetail): PullRequestState {
  if (pull.merged) return 'merged';
  if (pull.state === 'closed') return 'closed';
  if (pull.draft) return 'draft';
  const states = latestReviewStates(pull.reviews);
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (states.includes('APPROVED')) return 'approved';
  return 'review';
}

async function readOne(
  connection: GitHubConnection,
  url: string,
  address: PullAddress,
): Promise<PullRequestStatus | null> {
  try {
    const pull = await connection.getPullRequest(address, address.number);
    return {
      url,
      repo: `${address.owner}/${address.name}`,
      number: address.number,
      state: pullRequestState(pull),
      openedAt: pull.createdAt,
      mergedAt: pull.mergedAt,
      checks: pull.checks,
    };
  } catch {
    return null;
  }
}

export async function readPullStatuses(
  deps: GitHubDeps,
  urls: readonly string[],
): Promise<Map<string, PullRequestStatus>> {
  const byRepo = new Map<string, { url: string; address: PullAddress }[]>();
  for (const url of new Set(urls)) {
    const address = parsePullUrl(url);
    if (!address) continue;
    const key = `${address.host}/${address.owner}/${address.name}`.toLowerCase();
    byRepo.set(key, [...(byRepo.get(key) ?? []), { url, address }]);
  }
  const statuses = new Map<string, PullRequestStatus>();
  for (const pulls of byRepo.values()) {
    const connection = await connectionFor(deps, pulls[0]!.address).catch(() => null);
    if (!connection) continue;
    const read = await Promise.all(
      pulls.map((pull) => readOne(connection, pull.url, pull.address)),
    );
    for (const status of read) if (status) statuses.set(status.url, status);
  }
  return statuses;
}
