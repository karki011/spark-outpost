import { GitHubApiError, type GitHubRequest, type GitHubResponse } from './connection.ts';

const MAX_PAUSE_MS = 60 * 60_000;

function pauseUntil(response: GitHubResponse, now: number): number | null {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = Number(response.header('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return now + Math.min(retryAfter * 1000, MAX_PAUSE_MS);
  }
  if (response.header('x-ratelimit-remaining') !== '0') return null;
  const reset = Number(response.header('x-ratelimit-reset')) * 1000;
  if (!Number.isFinite(reset) || reset <= now) return null;
  return Math.min(reset, now + MAX_PAUSE_MS);
}

function limitError(until: number): GitHubApiError {
  const time = new Date(until).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return new GitHubApiError(429, `GitHub's rate limit is used up. Try again after ${time}.`);
}

export interface RateLimit {
  until: number;
}

export function honouringRateLimit(
  request: GitHubRequest,
  limit: RateLimit,
  now: () => number,
): GitHubRequest {
  return async (method, path, body) => {
    if (now() < limit.until) throw limitError(limit.until);
    const response = await request(method, path, body);
    const until = pauseUntil(response, now());
    if (until === null) return response;
    limit.until = until;
    throw limitError(until);
  };
}
