import { z } from 'zod';
import type { PrCheckRun, PrChecks, PrFailingCheck, PrReview } from '@spark-outpost/contracts';
import type { NewFeedback } from '../persistence/pr-watches.ts';
import { repoPath, type GitHubConnection, type RepoRef } from '../ship/github/connection.ts';
import { checkRunsState, failedCheckRuns } from '../ship/github/check-runs.ts';
import { GITHUB_PAGE_SIZE } from '../ship/github/pull-reads.ts';
import { checkRunsView, SPARK_REPLY_MARKER, type Discussion } from '../pr-tracking/details.ts';
import { reviewVerdict } from '../tickets/pull-status.ts';

export { SPARK_REPLY_MARKER };
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
  title: z.string().optional(),
  user: loginSchema.optional(),
  created_at: z.string().optional(),
  head: z.object({ sha: z.string().min(1), ref: z.string().optional() }),
  base: z.object({ ref: z.string().optional() }).optional(),
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
  in_reply_to_id: z.number().int().nullable().optional(),
  created_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

const reviewSchema = z.object({
  id: z.number().int(),
  user: loginSchema,
  body: z.string().nullable().optional(),
  state: z.string(),
  submitted_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

const issueCommentSchema = z.object({
  id: z.number().int(),
  user: loginSchema,
  body: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

export interface PullFacts {
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  headSha: string;
  title: string | null;
  head: string | null;
  base: string | null;
  author: string | null;
  createdAt: string | null;
}

export type Gathered = Omit<NewFeedback, 'trusted'>;

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
    title: pull.title ?? null,
    head: pull.head.ref ?? null,
    base: pull.base?.ref ?? null,
    author: pull.user?.login ?? null,
    createdAt: pull.created_at ?? null,
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
  run: CheckRun,
): Promise<string> {
  const lines = [
    `Check "${run.name}" ended with ${run.conclusion}.`,
    run.output?.title ?? '',
    run.output?.summary ?? '',
    ...(await annotations(connection, repo, run.id)),
  ];
  return capped(lines.filter((line) => line.trim()).join('\n'));
}

type CheckRun = z.infer<typeof checkRunSchema>;

export interface CheckSummary {
  state: PrChecks;
  failingChecks: PrFailingCheck[];
  checkRuns: PrCheckRun[];
}

export const MAX_FAILING_NAMES = 20;

function failingNames(runs: readonly CheckRun[]): PrFailingCheck[] {
  const byName = new Map<string, PrFailingCheck>();
  for (const run of runs) {
    if (!byName.has(run.name)) byName.set(run.name, { name: run.name, url: run.html_url ?? null });
  }
  return [...byName.values()].slice(0, MAX_FAILING_NAMES);
}

async function failedRuns(
  connection: GitHubConnection,
  repo: RepoRef,
  headSha: string,
): Promise<CheckSummary & { failed: CheckRun[] }> {
  const { check_runs: runs } = await connection.get(
    `${repoPath(repo)}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=${GITHUB_PAGE_SIZE}`,
    checkRunsSchema,
    'reading the checks',
  );
  const state = checkRunsState(runs);
  const failed = state === 'failing' ? failedCheckRuns(runs) : [];
  return { state, failingChecks: failingNames(failed), checkRuns: checkRunsView(runs), failed };
}

export async function readCheckSummary(
  connection: GitHubConnection,
  repo: RepoRef,
  headSha: string,
): Promise<CheckSummary> {
  const { state, failingChecks, checkRuns } = await failedRuns(connection, repo, headSha);
  return { state, failingChecks, checkRuns };
}

export async function readChecks(
  connection: GitHubConnection,
  repo: RepoRef,
  headSha: string,
): Promise<CheckSummary & { failing: Gathered[] }> {
  const { state, failingChecks, checkRuns, failed } = await failedRuns(connection, repo, headSha);
  const failing: Gathered[] = [];
  for (const run of failed.slice(0, MAX_FAILING_CHECKS)) {
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
  return { state, failingChecks, checkRuns, failing };
}

const fromSpark = (body: string) => body.includes(SPARK_REPLY_MARKER);

function verdictOf(reviews: readonly z.infer<typeof reviewSchema>[]): PrReview {
  return reviewVerdict(
    reviews.map((review) => ({ user: login(review.user), state: review.state })),
  );
}

export async function readComments(
  connection: GitHubConnection,
  repo: RepoRef,
  number: number,
): Promise<{ gathered: Gathered[]; review: PrReview; discussion: Discussion }> {
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
  return { gathered, review: verdictOf(reviews), discussion: { reviews, inline, issue } };
}
