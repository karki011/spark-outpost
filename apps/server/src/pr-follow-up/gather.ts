import { z } from 'zod';
import type { PrChecks } from '@spark-outpost/contracts';
import type { NewFeedback } from '../persistence/pr-watches.ts';
import { repoPath, type GitHubConnection, type RepoRef } from '../ship/github/connection.ts';
import { ciStatus, GITHUB_PAGE_SIZE } from '../ship/github/pull-reads.ts';

export const SPARK_REPLY_MARKER = '<!-- spark-outpost:follow-up -->';
export const MAX_BODY_CHARS = 4_000;
const MAX_PAGES = 5;
const MAX_FAILING_CHECKS = 5;
const MAX_ANNOTATIONS = 5;

const loginSchema = z.object({ login: z.string() }).nullable();

const pullSchema = z.object({
  state: z.enum(['open', 'closed']),
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  head: z.object({ sha: z.string().min(1) }),
});

const checkRunSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string().nullable().optional(),
  app: z.object({ slug: z.string() }).nullable().optional(),
  output: z
    .object({ title: z.string().nullable().optional(), summary: z.string().nullable().optional() })
    .nullable()
    .optional(),
});
const checkRunsSchema = z.object({ check_runs: z.array(checkRunSchema) });

const annotationSchema = z.object({
  path: z.string(),
  start_line: z.number().int().nullable().optional(),
  annotation_level: z.string().nullable().optional(),
  message: z.string(),
});

const reviewCommentSchema = z.object({
  id: z.number().int(),
  user: loginSchema,
  body: z.string(),
  path: z.string(),
  line: z.number().int().nullable().optional(),
  original_line: z.number().int().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

const reviewSchema = z.object({
  id: z.number().int(),
  user: loginSchema,
  body: z.string().nullable().optional(),
  state: z.string(),
  html_url: z.string().nullable().optional(),
});

const issueCommentSchema = z.object({
  id: z.number().int(),
  user: loginSchema,
  body: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

export interface PullFacts {
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  headSha: string;
}

export type Gathered = Omit<NewFeedback, 'trusted'>;

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);
const login = (user: z.infer<typeof loginSchema>) => user?.login ?? 'ghost';
const capped = (text: string) =>
  text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS - 1)}…` : text;

export async function readPullFacts(
  connection: GitHubConnection,
  repo: RepoRef,
  number: number,
): Promise<PullFacts> {
  const pull = await connection.get(
    `${repoPath(repo)}/pulls/${number}`,
    pullSchema,
    `reading pull request #${number}`,
  );
  const merged = pull.merged ?? pull.merged_at != null;
  return {
    state: merged ? 'merged' : pull.state,
    draft: pull.draft ?? false,
    headSha: pull.head.sha,
  };
}

async function pages<T>(
  connection: GitHubConnection,
  path: string,
  schema: z.ZodType<T>,
  action: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const list = await connection.get(
      `${path}?per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
      z.array(schema),
      action,
    );
    all.push(...list);
    if (list.length < GITHUB_PAGE_SIZE) break;
  }
  return all;
}

async function annotations(connection: GitHubConnection, repo: RepoRef, id: number) {
  const list = await connection
    .get(
      `${repoPath(repo)}/check-runs/${id}/annotations?per_page=${MAX_ANNOTATIONS}`,
      z.array(annotationSchema),
      'reading check annotations',
    )
    .catch(() => []);
  return list
    .filter((note) => note.annotation_level !== 'notice')
    .slice(0, MAX_ANNOTATIONS)
    .map((note) => `${note.path}${note.start_line ? `:${note.start_line}` : ''}: ${note.message}`);
}

async function checkExcerpt(
  connection: GitHubConnection,
  repo: RepoRef,
  run: z.infer<typeof checkRunSchema>,
): Promise<string> {
  const lines = [
    `Check "${run.name}" ended with ${run.conclusion}.`,
    run.output?.title ?? '',
    run.output?.summary ?? '',
    ...(await annotations(connection, repo, run.id)),
  ];
  return capped(lines.filter((line) => line.trim()).join('\n'));
}

export async function readChecks(
  connection: GitHubConnection,
  repo: RepoRef,
  headSha: string,
): Promise<{ state: PrChecks; failing: Gathered[] }> {
  const { check_runs: runs } = await connection.get(
    `${repoPath(repo)}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=${GITHUB_PAGE_SIZE}`,
    checkRunsSchema,
    'reading the checks',
  );
  const failingRuns = runs.filter((run) => run.conclusion && FAILED.has(run.conclusion));
  const failing: Gathered[] = [];
  for (const run of failingRuns.slice(0, MAX_FAILING_CHECKS)) {
    failing.push({
      sourceKey: `check:${run.name}:${headSha}`,
      kind: 'check',
      githubId: String(run.id),
      author: run.app?.slug ?? 'CI',
      path: null,
      line: null,
      body: await checkExcerpt(connection, repo, run),
      url: run.html_url ?? null,
    });
  }
  return { state: ciStatus(runs).state, failing };
}

const fromSpark = (body: string) => body.includes(SPARK_REPLY_MARKER);

export async function readComments(
  connection: GitHubConnection,
  repo: RepoRef,
  number: number,
): Promise<Gathered[]> {
  const pull = `${repoPath(repo)}/pulls/${number}`;
  const [inline, reviews, issue] = await Promise.all([
    pages(connection, `${pull}/comments`, reviewCommentSchema, 'reading review comments'),
    pages(connection, `${pull}/reviews`, reviewSchema, 'reading reviews'),
    pages(
      connection,
      `${repoPath(repo)}/issues/${number}/comments`,
      issueCommentSchema,
      'reading comments',
    ),
  ]);
  const gathered: Gathered[] = [];
  for (const comment of inline) {
    if (fromSpark(comment.body) || !comment.body.trim()) continue;
    gathered.push({
      sourceKey: `review_comment:${comment.id}`,
      kind: 'review_comment',
      githubId: String(comment.id),
      author: login(comment.user),
      path: comment.path,
      line: comment.line ?? comment.original_line ?? null,
      body: capped(comment.body),
      url: comment.html_url ?? null,
    });
  }
  for (const review of reviews) {
    const body = review.body?.trim() ?? '';
    if (!body || fromSpark(body)) continue;
    if (review.state !== 'CHANGES_REQUESTED' && review.state !== 'COMMENTED') continue;
    gathered.push({
      sourceKey: `review:${review.id}`,
      kind: 'review',
      githubId: String(review.id),
      author: login(review.user),
      path: null,
      line: null,
      body: capped(body),
      url: review.html_url ?? null,
    });
  }
  for (const comment of issue) {
    const body = comment.body?.trim() ?? '';
    if (!body || fromSpark(body)) continue;
    gathered.push({
      sourceKey: `issue_comment:${comment.id}`,
      kind: 'issue_comment',
      githubId: String(comment.id),
      author: login(comment.user),
      path: null,
      line: null,
      body: capped(body),
      url: comment.html_url ?? null,
    });
  }
  return gathered;
}
