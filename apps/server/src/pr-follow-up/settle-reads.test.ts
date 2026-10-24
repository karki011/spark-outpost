import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { GitHubConnection } from '../ship/github/connection.ts';
import { readResolved } from '../pr-tracking/details.ts';
import { readChecks } from './gather.ts';
import { settledOnGitHub } from './sweep.ts';

const REPO = { owner: 'acme', name: 'widgets' };

function connection(answers: {
  get?: (path: string) => unknown;
  post?: (query: string) => unknown;
}): GitHubConnection & { queries: string[] } {
  const queries: string[] = [];
  const reply = <T>(data: unknown, schema: z.ZodType<T>) => Promise.resolve(schema.parse(data));
  return {
    queries,
    get: <T>(path: string, schema: z.ZodType<T>) => reply(answers.get?.(path), schema),
    post: <T>(_path: string, body: Record<string, string>, schema: z.ZodType<T>) => {
      queries.push(body.query ?? '');
      const answer = answers.post?.(body.query ?? '');
      return answer instanceof Error ? Promise.reject(answer) : reply(answer, schema);
    },
  } as unknown as GitHubConnection & { queries: string[] };
}

function threads(roots: number[], resolved: number[], next: string | null) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: next !== null, endCursor: next },
            nodes: roots.map((root) => ({
              isResolved: resolved.includes(root),
              comments: { nodes: [{ databaseId: root }] },
            })),
          },
        },
      },
    },
  };
}

describe('the settlement sweep reads all of GitHub, not the shown slice', () => {
  it('finds a check that now passes beyond the 60 checks the details show', async () => {
    const failing = Array.from({ length: 70 }, (_, index) => ({
      id: index + 1,
      name: `lint-${String(index).padStart(2, '0')}`,
      status: 'completed',
      conclusion: 'failure',
    }));
    const passing = { id: 100, name: 'zz-unit', status: 'completed', conclusion: 'success' };
    const github = connection({
      get: (path) => (path.includes('/annotations') ? [] : { check_runs: [...failing, passing] }),
    });
    const checks = await readChecks(github, REPO, 'sha-2');
    expect(checks.checkRuns).toHaveLength(60);
    expect(checks.checkRuns.some((run) => run.name === 'zz-unit')).toBe(false);
    const item = {
      id: 'unit',
      kind: 'check' as const,
      sourceKey: 'check:zz-unit:sha-1',
      githubId: '9',
      author: 'CI',
      trusted: true,
      state: 'needs_user' as const,
    };
    const now = { prAuthor: 'alice', resolved: null, inline: [], reviews: [] };
    expect(settledOnGitHub([item], { ...now, checkRuns: checks.latest })).toEqual(['unit']);
  });

  it('reads check runs past the first page of 100', async () => {
    const failing = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: `lint-${String(index).padStart(3, '0')}`,
      status: 'completed',
      conclusion: 'failure',
    }));
    const rerun = { id: 200, name: 'unit', status: 'completed', conclusion: 'success' };
    const read: string[] = [];
    const github = connection({
      get: (path) => {
        read.push(path);
        if (path.includes('/annotations')) return [];
        if (path.includes('page=2')) return { check_runs: [rerun] };
        return { check_runs: path.includes('page=1') ? failing : [] };
      },
    });
    const checks = await readChecks(github, REPO, 'sha-2');
    expect(read.filter((path) => path.includes('/check-runs?'))).toHaveLength(2);
    const item = {
      id: 'unit',
      kind: 'check' as const,
      sourceKey: 'check:unit:sha-1',
      githubId: '9',
      author: 'CI',
      trusted: true,
      state: 'needs_user' as const,
    };
    const now = { prAuthor: 'alice', resolved: null, inline: [], reviews: [] };
    expect(settledOnGitHub([item], { ...now, checkRuns: checks.latest })).toEqual(['unit']);
  });

  it('reads resolved threads past the first 100', async () => {
    const github = connection({
      post: (query) =>
        query.includes('after: "page-2"')
          ? threads([150], [150], null)
          : threads([1], [], 'page-2'),
    });
    expect(await readResolved(github, REPO, 7)).toEqual(new Set([150]));
    expect(github.queries).toHaveLength(2);
  });

  it('keeps the threads it read when a later page fails, and says nothing when the first fails', async () => {
    const later = connection({
      post: (query) =>
        query.includes('after:') ? new Error('rate limited') : threads([1], [1], 'page-2'),
    });
    expect(await readResolved(later, REPO, 7)).toEqual(new Set([1]));
    const first = connection({ post: () => new Error('rate limited') });
    expect(await readResolved(first, REPO, 7)).toBeNull();
  });
});
