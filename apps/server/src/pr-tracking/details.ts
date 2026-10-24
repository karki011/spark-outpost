import { z } from 'zod';
import type { PrCheckRun, PrCheckState, PrReviewer } from '@spark-outpost/contracts';
import { repoPath, type GitHubConnection, type RepoRef } from '../ship/github/connection.ts';
import { GITHUB_PAGE_SIZE } from '../ship/github/pull-reads.ts';
import { plainExcerpt } from './plain-text.ts';

export const SPARK_REPLY_MARKER = '<!-- spark-outpost:follow-up -->';
const MAX_CHECK_RUNS = 60;
const MAX_REVIEWERS = 20;
const MAX_THREADS = 50;
const SUMMARY_CHARS = 160;
const EXCERPT_CHARS = 220;

export interface StoredThread {
  key: string;
  author: string;
  path: string | null;
  line: number | null;
  excerpt: string;
  url: string | null;
  at: string | null;
}

export interface StoredDetails {
  checkRuns: PrCheckRun[];
  reviewers: PrReviewer[];
  threads: StoredThread[];
  threadCount: number;
}

export const NO_DETAILS: StoredDetails = {
  checkRuns: [],
  reviewers: [],
  threads: [],
  threadCount: 0,
};

const storedDetailsSchema = z.object({
  checkRuns: z.array(
    z.object({
      name: z.string(),
      url: z.string().nullable(),
      state: z.enum(['failing', 'running', 'passing', 'cancelled', 'skipped', 'neutral']),
      summary: z.string().nullable(),
    }),
  ),
  reviewers: z.array(
    z.object({
      user: z.string(),
      state: z.enum(['approved', 'changes_requested', 'commented']),
      at: z.string().nullable(),
      url: z.string().nullable(),
    }),
  ),
  threads: z.array(
    z.object({
      key: z.string(),
      author: z.string(),
      path: z.string().nullable(),
      line: z.number().int().nullable(),
      excerpt: z.string(),
      url: z.string().nullable(),
      at: z.string().nullable(),
    }),
  ),
  threadCount: z.number().int().nonnegative(),
});

export function parseDetails(value: unknown): StoredDetails {
  const parsed = storedDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : NO_DETAILS;
}

export interface CheckRunFields {
  id?: number | undefined;
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string | null | undefined;
  output?: { title?: string | null | undefined } | null | undefined;
}

const FAILED = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
const ORDER: readonly PrCheckState[] = [
  'failing',
  'cancelled',
  'running',
  'neutral',
  'skipped',
  'passing',
];

function checkState(run: CheckRunFields): PrCheckState {
  if (run.status !== 'completed') return 'running';
  if (run.conclusion === 'success') return 'passing';
  if (run.conclusion === 'cancelled') return 'cancelled';
  if (run.conclusion === 'skipped') return 'skipped';
  return run.conclusion !== null && FAILED.has(run.conclusion) ? 'failing' : 'neutral';
}

export function checkRunsView(runs: readonly CheckRunFields[]): PrCheckRun[] {
  const latest = new Map<string, CheckRunFields>();
  for (const run of runs) {
    const known = latest.get(run.name);
    if (!known || (run.id ?? 0) > (known.id ?? 0)) latest.set(run.name, run);
  }
  return [...latest.values()]
    .map((run) => ({
      name: run.name,
      url: run.html_url ?? null,
      state: checkState(run),
      summary: run.output?.title?.trim() ? plainExcerpt(run.output.title, SUMMARY_CHARS) : null,
    }))
    .toSorted(
      (a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_CHECK_RUNS);
}

const loginSchema = z.object({ login: z.string() }).nullable().optional();

const reviewSchema = z.object({
  user: loginSchema,
  state: z.string(),
  submitted_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

const inlineSchema = z.object({
  id: z.number().int().optional(),
  user: loginSchema,
  body: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  line: z.number().int().nullable().optional(),
  original_line: z.number().int().nullable().optional(),
  in_reply_to_id: z.number().int().nullable().optional(),
  created_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

const issueSchema = z.object({
  id: z.number().int().optional(),
  user: loginSchema,
  body: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

export interface Discussion {
  reviews: readonly z.infer<typeof reviewSchema>[];
  inline: readonly z.infer<typeof inlineSchema>[];
  issue: readonly z.infer<typeof issueSchema>[];
}

const REVIEW_STATES: Record<string, PrReviewer['state']> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
};

const login = (user: z.infer<typeof loginSchema>) => user?.login ?? 'ghost';
const newestFirst = (a: { at: string | null }, b: { at: string | null }) =>
  (b.at ?? '').localeCompare(a.at ?? '');

export function reviewersOf(reviews: Discussion['reviews']): PrReviewer[] {
  const latest = new Map<string, PrReviewer>();
  for (const review of reviews) {
    const state = REVIEW_STATES[review.state];
    if (!state) continue;
    const user = login(review.user);
    const known = latest.get(user);
    if (known && known.state !== 'commented' && state === 'commented') continue;
    latest.set(user, {
      user,
      state,
      at: review.submitted_at ?? null,
      url: review.html_url ?? null,
    });
  }
  return [...latest.values()].toSorted(newestFirst).slice(0, MAX_REVIEWERS);
}

function spoken(body: string | null | undefined): string | null {
  const text = body?.trim() ?? '';
  return text && !text.includes(SPARK_REPLY_MARKER) ? text : null;
}

export function threadsOf(
  discussion: Pick<Discussion, 'inline' | 'issue'>,
  resolved: ReadonlySet<number> | null,
): Pick<StoredDetails, 'threads' | 'threadCount'> {
  const threads: StoredThread[] = [];
  for (const comment of discussion.inline) {
    const body = spoken(comment.body);
    if (!body || comment.id === undefined || comment.in_reply_to_id) continue;
    if (resolved?.has(comment.id)) continue;
    threads.push({
      key: `review_comment:${comment.id}`,
      author: login(comment.user),
      path: comment.path ?? null,
      line: comment.line ?? comment.original_line ?? null,
      excerpt: plainExcerpt(body, EXCERPT_CHARS),
      url: comment.html_url ?? null,
      at: comment.created_at ?? null,
    });
  }
  for (const comment of discussion.issue) {
    const body = spoken(comment.body);
    if (!body || comment.id === undefined) continue;
    threads.push({
      key: `issue_comment:${comment.id}`,
      author: login(comment.user),
      path: null,
      line: null,
      excerpt: plainExcerpt(body, EXCERPT_CHARS),
      url: comment.html_url ?? null,
      at: comment.created_at ?? null,
    });
  }
  const open = threads.filter((thread) => thread.excerpt).toSorted(newestFirst);
  return { threads: open.slice(0, MAX_THREADS), threadCount: open.length };
}

const resolvedSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          nodes: z.array(
            z.object({
              isResolved: z.boolean(),
              comments: z.object({
                nodes: z.array(z.object({ databaseId: z.number().int().nullable() })),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

function resolvedQuery(repo: RepoRef, number: number): string {
  const owner = JSON.stringify(repo.owner);
  const name = JSON.stringify(repo.name);
  return `query { repository(owner: ${owner}, name: ${name}) { pullRequest(number: ${number}) { reviewThreads(first: 100) { nodes { isResolved comments(first: 1) { nodes { databaseId } } } } } } }`;
}

export async function readResolved(
  connection: GitHubConnection,
  repo: RepoRef,
  number: number,
): Promise<Set<number> | null> {
  const answer = await connection
    .post('/graphql', { query: resolvedQuery(repo, number) }, resolvedSchema, 'reading threads')
    .catch(() => null);
  if (!answer) return null;
  const resolved = new Set<number>();
  for (const thread of answer.data.repository.pullRequest.reviewThreads.nodes) {
    const root = thread.comments.nodes[0]?.databaseId;
    if (thread.isResolved && root != null) resolved.add(root);
  }
  return resolved;
}

export async function readDiscussion(
  connection: GitHubConnection,
  repo: RepoRef,
  number: number,
): Promise<Discussion> {
  const pull = `${repoPath(repo)}/pulls/${number}`;
  const page = `?per_page=${GITHUB_PAGE_SIZE}`;
  const [reviews, inline, issue] = await Promise.all([
    connection.get(`${pull}/reviews${page}`, z.array(reviewSchema), 'reading reviews'),
    connection.get(`${pull}/comments${page}`, z.array(inlineSchema), 'reading review comments'),
    connection.get(
      `${repoPath(repo)}/issues/${number}/comments${page}`,
      z.array(issueSchema),
      'reading comments',
    ),
  ]);
  return { reviews, inline, issue };
}

export async function threadResolution(
  connection: GitHubConnection,
  repo: RepoRef,
  number: number,
  discussion: Pick<Discussion, 'inline'>,
): Promise<Set<number> | null> {
  const hasThreads = discussion.inline.some((comment) => !comment.in_reply_to_id);
  return hasThreads ? readResolved(connection, repo, number) : null;
}

export function detailsOf(
  discussion: Discussion,
  resolved: ReadonlySet<number> | null,
): Omit<StoredDetails, 'checkRuns'> {
  return { reviewers: reviewersOf(discussion.reviews), ...threadsOf(discussion, resolved) };
}

export async function discussionDetails(
  connection: GitHubConnection,
  repo: RepoRef,
  number: number,
  discussion: Discussion,
): Promise<Omit<StoredDetails, 'checkRuns'>> {
  return detailsOf(discussion, await threadResolution(connection, repo, number, discussion));
}
