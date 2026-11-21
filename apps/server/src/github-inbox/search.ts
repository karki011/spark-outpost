import { z } from 'zod';
import type { PullRequestChecks } from '@spark-outpost/contracts';

const TEXT_LIMIT = 300;
const LOGIN_LIMIT = 100;
const PREVIEW_LIMIT = 2_000;
const LABEL_LIMIT = 10;
const MAX_RESULTS = 50;
const QUERY_LIMIT = 250;
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

export interface InboxRepo {
  owner: string;
  name: string;
}

export interface FoundPull {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  authorIsBot: boolean;
  draft: boolean;
  updatedAt: string;
  createdAt: string;
  headRef: string;
  baseRef: string;
  labels: { name: string; color: string | null }[];
  assignees: string[];
  comments: number | null;
  bodyPreview: string;
  headSha: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  reviewDecision: string | null;
  mergeable: string | null;
  mergeState: string | null;
  requestedReviewers: string[];
  reviews: { login: string; state: string }[];
  viewerReview: string | null;
  unresolvedThreads: number | null;
  checks: PullRequestChecks | null;
  failingChecks: number;
  reviewRequested: boolean;
  reviewedByViewer: boolean;
}

interface SearchPage {
  viewer: string | null;
  pulls: FoundPull[];
  truncated: boolean;
  error: string | null;
}

const PULL_FIELDS = `number title url isDraft updatedAt createdAt headRefName baseRefName headRefOid bodyText labels(first: 10) { nodes { name color } } assignees(first: 10) { nodes { login } } comments { totalCount } additions deletions changedFiles reviewDecision mergeable mergeStateStatus repository { nameWithOwner } author { __typename login } reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } } latestReviews(first: 20) { nodes { state author { login } } } viewerLatestReview { state } reviewThreads(first: 100) { nodes { isResolved } } commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { ... on CheckRun { status conclusion } } } } } } }`;

const safeRepo = (repo: InboxRepo) => SAFE_NAME.test(repo.owner) && SAFE_NAME.test(repo.name);

export type InboxPart = 'review' | 'mine' | 'reviewed';

function filters(kind: 'review-requested' | 'author' | 'reviewed-by', since: string): string {
  const others = kind === 'reviewed-by' ? ' -author:@me' : '';
  return `is:pr is:open archived:false ${kind}:@me${others} updated:>=${since} sort:updated-desc`;
}

export function repoChunks(repos: readonly InboxRepo[], since: string): InboxRepo[][] {
  const budget = QUERY_LIMIT - filters('review-requested', since).length;
  const chunks: InboxRepo[][] = [];
  let current: InboxRepo[] = [];
  let used = 0;
  for (const repo of repos.filter(safeRepo)) {
    const size = ` repo:${repo.owner}/${repo.name}`.length;
    if (current.length > 0 && used + size > budget) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(repo);
    used += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function searchField(alias: string, search: string): string {
  return `${alias}: search(query: ${JSON.stringify(search)}, type: ISSUE, first: ${MAX_RESULTS}) { issueCount nodes { ... on PullRequest { ${PULL_FIELDS} } } }`;
}

export function inboxQuery(repos: readonly InboxRepo[], since: string): string {
  const scope = repos.map((repo) => ` repo:${repo.owner}/${repo.name}`).join('');
  return `query { viewer { login } ${searchField('mine', `${filters('author', since)}${scope}`)} }`;
}

export function reviewRequestsQuery(since: string): string {
  const requested = searchField('review', filters('review-requested', since));
  const reviewed = searchField('reviewed', filters('reviewed-by', since));
  return `query { viewer { login } ${requested} ${reviewed} }`;
}

const searchSchema = z.object({
  issueCount: z.number().int().nonnegative(),
  nodes: z.array(z.unknown()),
});

const inboxEnvelopeSchema = z.object({
  data: z
    .object({
      viewer: z
        .object({ login: z.string().min(1).max(LOGIN_LIMIT) })
        .nullable()
        .catch(null),
      review: searchSchema.nullish().catch(null),
      mine: searchSchema.nullish().catch(null),
      reviewed: searchSchema.nullish().catch(null),
    })
    .nullable()
    .catch(null),
  errors: z
    .array(z.object({ message: z.string() }).passthrough())
    .optional()
    .catch(undefined),
});

const count = z.number().int().nonnegative().nullable().catch(null);
const loginOf = z
  .object({ login: z.string().min(1).max(LOGIN_LIMIT) })
  .nullable()
  .catch(null);
const nodesOf = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({ nodes: z.array(item.nullable().catch(null)) })
    .nullable()
    .catch(null);

const rollupSchema = z
  .object({
    state: z.string(),
    contexts: nodesOf(
      z.object({ status: z.string().optional(), conclusion: z.string().nullable().optional() }),
    ),
  })
  .nullable()
  .catch(null);

const pullNodeSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  isDraft: z.boolean().catch(false),
  updatedAt: z.string().min(1),
  createdAt: z.string().catch(''),
  headRefName: z.string().catch(''),
  baseRefName: z.string().catch(''),
  bodyText: z.string().catch(''),
  labels: nodesOf(
    z.object({
      name: z.string().min(1),
      color: z
        .string()
        .regex(/^[0-9a-fA-F]{6}$/)
        .nullable()
        .catch(null),
    }),
  ),
  assignees: nodesOf(loginOf),
  comments: z.object({ totalCount: z.number().int().nonnegative() }).nullable().catch(null),
  headRefOid: z.string().regex(/^[0-9a-f]{40,64}$/),
  additions: count,
  deletions: count,
  changedFiles: count,
  reviewDecision: z.string().nullable().catch(null),
  mergeable: z.string().nullable().catch(null),
  mergeStateStatus: z.string().nullable().catch(null),
  repository: z.object({ nameWithOwner: z.string().regex(/^[^/\s]+\/[^/\s]+$/) }),
  author: z
    .object({ __typename: z.string().optional(), login: z.string().min(1).max(LOGIN_LIMIT) })
    .nullable()
    .catch(null),
  reviewRequests: nodesOf(z.object({ requestedReviewer: loginOf })),
  latestReviews: nodesOf(z.object({ state: z.string(), author: loginOf })),
  viewerLatestReview: z.object({ state: z.string() }).nullable().catch(null),
  reviewThreads: nodesOf(z.object({ isResolved: z.boolean() })),
  commits: nodesOf(z.object({ commit: z.object({ statusCheckRollup: rollupSchema }) })),
});

type PullNode = z.infer<typeof pullNodeSchema>;

function checksOf(state: string | undefined): PullRequestChecks | null {
  if (state === 'SUCCESS') return 'passing';
  if (state === 'FAILURE' || state === 'ERROR') return 'failing';
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending';
  return null;
}

const present = <T>(values: readonly (T | null)[] | undefined): T[] =>
  (values ?? []).filter((value): value is T => value !== null);

function isBot(author: PullNode['author']): boolean {
  if (!author) return false;
  return author.__typename === 'Bot' || author.login.toLowerCase().endsWith('[bot]');
}

function toFound(node: PullNode, part: InboxPart): FoundPull {
  const rollup = present(node.commits?.nodes)[0]?.commit.statusCheckRollup ?? null;
  const checks = checksOf(rollup?.state);
  const failed = present(rollup?.contexts?.nodes).filter(
    (context) => context.conclusion != null && FAILED_CONCLUSIONS.has(context.conclusion),
  ).length;
  const threads = node.reviewThreads ? present(node.reviewThreads.nodes) : null;
  return {
    repo: node.repository.nameWithOwner,
    number: node.number,
    title: node.title.slice(0, TEXT_LIMIT),
    url: node.url,
    author: node.author?.login ?? 'ghost',
    authorIsBot: isBot(node.author),
    draft: node.isDraft,
    updatedAt: node.updatedAt,
    createdAt: node.createdAt || node.updatedAt,
    headRef: node.headRefName.slice(0, TEXT_LIMIT),
    baseRef: node.baseRefName.slice(0, TEXT_LIMIT),
    labels: present(node.labels?.nodes)
      .slice(0, LABEL_LIMIT)
      .map((label) => ({ name: label.name.slice(0, LOGIN_LIMIT), color: label.color })),
    assignees: present(node.assignees?.nodes).flatMap((assignee) => assignee?.login ?? []),
    comments: node.comments?.totalCount ?? null,
    bodyPreview: node.bodyText.slice(0, PREVIEW_LIMIT),
    headSha: node.headRefOid,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    reviewDecision: node.reviewDecision,
    mergeable: node.mergeable,
    mergeState: node.mergeStateStatus,
    requestedReviewers: present(node.reviewRequests?.nodes).flatMap(
      (request) => request.requestedReviewer?.login ?? [],
    ),
    reviews: present(node.latestReviews?.nodes).flatMap((review) =>
      review.author ? [{ login: review.author.login, state: review.state }] : [],
    ),
    viewerReview: node.viewerLatestReview?.state ?? null,
    unresolvedThreads: threads ? threads.filter((thread) => !thread.isResolved).length : null,
    checks,
    failingChecks: checks === 'failing' ? Math.max(failed, 1) : failed,
    reviewRequested: part === 'review',
    reviewedByViewer: part === 'reviewed',
  };
}

function pullsIn(search: z.infer<typeof searchSchema> | null, part: InboxPart) {
  const pulls: FoundPull[] = [];
  for (const node of search?.nodes ?? []) {
    const parsed = pullNodeSchema.safeParse(node);
    if (parsed.success) pulls.push(toFound(parsed.data, part));
  }
  return pulls;
}

const truncatedSearch = (search: z.infer<typeof searchSchema> | null) =>
  search !== null && search.issueCount > search.nodes.length;

export function parseInboxPage(body: unknown, part: InboxPart): SearchPage {
  const envelope = inboxEnvelopeSchema.safeParse(body);
  if (!envelope.success || !envelope.data.data) {
    const message = envelope.success ? envelope.data.errors?.[0]?.message : undefined;
    return {
      viewer: null,
      pulls: [],
      truncated: false,
      error: message
        ? `GitHub refused the search: ${message.slice(0, 200)}`
        : 'GitHub sent an unexpected answer to the search.',
    };
  }
  const { viewer } = envelope.data.data;
  const search = envelope.data.data[part] ?? null;
  return {
    viewer: viewer?.login ?? null,
    pulls: pullsIn(search, part),
    truncated: truncatedSearch(search),
    error: search === null ? 'GitHub left part of the search unanswered.' : null,
  };
}
