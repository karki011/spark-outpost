import { describe, expect, it } from 'vitest';
import type { GitHubRequest, GitHubResponse } from './connection.ts';
import { honouringRateLimit } from './rate-limit.ts';

function response(status: number, headers: Record<string, string> = {}): GitHubResponse {
  return { status, data: null, header: (name) => headers[name] ?? null };
}

function counted(answers: GitHubResponse[]) {
  let calls = 0;
  const request: GitHubRequest = async () => answers[Math.min(calls++, answers.length - 1)]!;
  return { request, calls: () => calls };
}

describe('honouring GitHub rate limits', () => {
  it('pauses until Retry-After has passed, without calling GitHub meanwhile', async () => {
    let now = 1_000_000;
    const github = counted([response(429, { 'retry-after': '60' }), response(200)]);
    const request = honouringRateLimit(github.request, { until: 0 }, () => now);
    await expect(request('GET', '/user')).rejects.toThrow(/rate limit/);
    await expect(request('GET', '/user')).rejects.toThrow(/rate limit/);
    expect(github.calls()).toBe(1);
    now += 61_000;
    expect((await request('GET', '/user')).status).toBe(200);
  });

  it('pauses until the reset time when the quota is used up', async () => {
    const now = 1_700_000_000_000;
    const limit = { until: 0 };
    const github = counted([
      response(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000300' }),
    ]);
    await expect(
      honouringRateLimit(github.request, limit, () => now)('GET', '/user'),
    ).rejects.toMatchObject({ status: 429 });
    expect(limit.until).toBe(1_700_000_300_000);
  });

  it('passes an ordinary refusal through', async () => {
    const github = counted([response(403, { 'x-ratelimit-remaining': '41' })]);
    const request = honouringRateLimit(github.request, { until: 0 }, () => 0);
    expect((await request('GET', '/repos/acme/widgets')).status).toBe(403);
  });
});
