import { z } from 'zod';
import type { PullRequestState } from '@spark-outpost/contracts';
import { pullRequestState } from '../../tickets/pull-status.ts';
import { repoPath, type GitHubConnection, type RepoRef } from './connection.ts';

export const GITHUB_PAGE_SIZE = 100;

const loginSchema = z.object({ login: z.string() }).nullable();

const listedPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  html_url: z.string(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().optional(),
  user: loginSchema,
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string() }),
  created_at: z.string(),
  updated_at: z.string(),
});

const pullDetailSchema = listedPullSchema.extend({
  body: z.string().nullable().optional(),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  mergeable: z.boolean().nullable().optional(),
  mergeable_state: z.string().optional(),
  additions: z.number().int().default(0),
  deletions: z.number().int().default(0),
  changed_files: z.number().int().default(0),
  comments: z.number().int().default(0),
  review_comments: z.number().int().default(0),
});

const reviewSchema = z.object({ user: loginSchema, state: z.string() });

const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
  ),
});

const fileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
});

const reviewCommentSchema = z.object({
  path: z.string(),
  line: z.number().int().nullable().optional(),
  user: loginSchema,
  body: z.string(),
});

const issueCommentSchema = z.object({ user: loginSchema, body: z.string() });

type PullDetail = z.infer<typeof pullDetailSchema>;
type Review = z.infer<typeof reviewSchema>;
export type CheckRun = z.infer<typeof checkRunsSchema>['check_runs'][number];

export type CiStatus =
  { state: 'none' | 'pending' | 'passing' } | { state: 'failing'; failing: string[] };

export interface Range {
  offset: number;
  limit: number;
}

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

export function ciStatus(runs: readonly CheckRun[]): CiStatus {
  if (runs.length === 0) return { state: 'none' };
  const failing = runs
    .filter((run) => run.conclusion !== null && FAILED_CONCLUSIONS.has(run.conclusion))
    .map((run) => run.name);
  if (failing.length > 0) return { state: 'failing', failing };
  if (runs.some((run) => run.status !== 'completed')) return { state: 'pending' };
  return { state: 'passing' };
}

export function pagesCovering(range: Range): number[] {
  const first = Math.floor(range.offset / GITHUB_PAGE_SIZE) + 1;
  const last = Math.floor((range.offset + range.limit - 1) / GITHUB_PAGE_SIZE) + 1;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

const login = (user: z.infer<typeof loginSchema>) => user?.login ?? 'ghost';

function reviewState(pull: PullDetail, reviews: Review[]): PullRequestState {
  return pullRequestState({
    url: pull.html_url,
    number: pull.number,
    draft: pull.draft ?? false,
    state: pull.state,
    merged: pull.merged ?? pull.merged_at != null,
    createdAt: pull.created_at,
    mergedAt: pull.merged_at ?? null,
    reviews: reviews.map((review) => ({ user: login(review.user), state: review.state })),
    checks: null,
    headSha: pull.head.sha,
    failedChecks: [],
  });
}

async function readRange<T>(
  connection: GitHubConnection,
  path: string,
  schema: z.ZodType<T>,
  total: number,
  range: Range,
  action: string,
): Promise<T[]> {
  if (range.offset >= total) return [];
  const pages = pagesCovering(range);
  const lists = await Promise.all(
    pages.map((pageNumber) =>
      connection.get(
        `${path}?per_page=${GITHUB_PAGE_SIZE}&page=${pageNumber}`,
        z.array(schema),
        action,
      ),
    ),
  );
  const start = range.offset - (pages[0]! - 1) * GITHUB_PAGE_SIZE;
  return lists.flat().slice(start, start + range.limit);
}

async function pullBasics(connection: GitHubConnection, repo: RepoRef, number: number) {
  const path = `${repoPath(repo)}/pulls/${number}`;
  const pull = await connection.get(path, pullDetailSchema, `reading pull request #${number}`);
  const [reviews, checks] = await Promise.all([
    connection.get(
      `${path}/reviews?per_page=${GITHUB_PAGE_SIZE}`,
      z.array(reviewSchema),
      `reading the reviews of #${number}`,
    ),
    connection.get(
      `${repoPath(repo)}/commits/${encodeURIComponent(pull.head.sha)}/check-runs?per_page=${GITHUB_PAGE_SIZE}`,
      checkRunsSchema,
      `reading the checks of #${number}`,
    ),
  ]);
  return { path, pull, reviews, checks: checks.check_runs };
}

function summary(pull: PullDetail, reviews: Review[], checks: CheckRun[]) {
  return {
    number: pull.number,
    title: pull.title,
    author: login(pull.user),
    state: pull.state,
    draft: pull.draft ?? false,
    head: pull.head.ref,
    base: pull.base.ref,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    url: pull.html_url,
    reviewState: reviewState(pull, reviews),
    ci: ciStatus(checks),
    mergeable: pull.mergeable ?? null,
    mergeState: pull.mergeable_state ?? null,
  };
}

export type PullSummary = ReturnType<typeof summary>;

export async function listPulls(
  connection: GitHubConnection,
  repo: RepoRef,
  state: 'open' | 'closed' | 'all',
  limit: number,
): Promise<PullSummary[]> {
  const query = new URLSearchParams({ state, per_page: String(limit) });
  const listed = await connection.get(
    `${repoPath(repo)}/pulls?${query.toString()}`,
    z.array(listedPullSchema),
    'listing pull requests',
  );
  return Promise.all(
    listed.slice(0, limit).map(async ({ number }) => {
      const { pull, reviews, checks } = await pullBasics(connection, repo, number);
      return summary(pull, reviews, checks);
    }),
  );
}

export async function readPull(
  connection: GitHubConnection,
  repo: RepoRef,
  number: number,
  range: Range,
) {
  const { path, pull, reviews, checks } = await pullBasics(connection, repo, number);
  const issuePath = `${repoPath(repo)}/issues/${number}/comments`;
  const [files, reviewComments, issueComments] = await Promise.all([
    readRange(connection, `${path}/files`, fileSchema, pull.changed_files, range, 'reading files'),
    readRange(
      connection,
      `${path}/comments`,
      reviewCommentSchema,
      pull.review_comments,
      range,
      'reading review comments',
    ),
    readRange(connection, issuePath, issueCommentSchema, pull.comments, range, 'reading comments'),
  ]);
  return {
    ...summary(pull, reviews, checks),
    body: pull.body ?? '',
    merged: pull.merged ?? pull.merged_at != null,
    additions: pull.additions,
    deletions: pull.deletions,
    files: { total: pull.changed_files, items: files },
    checks,
    reviews: reviews.map((review) => ({ user: login(review.user), state: review.state })),
    reviewComments: {
      total: pull.review_comments,
      items: reviewComments.map((comment) => ({
        path: comment.path,
        line: comment.line ?? null,
        user: login(comment.user),
        body: comment.body,
      })),
    },
    issueComments: {
      total: pull.comments,
      items: issueComments.map((comment) => ({ user: login(comment.user), body: comment.body })),
    },
  };
}
