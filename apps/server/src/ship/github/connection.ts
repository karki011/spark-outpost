import { z } from 'zod';
import type { GitHubMethod, PullRequestChecks } from '@spark-outpost/contracts';

export interface RepoRef {
  owner: string;
  name: string;
}

export interface PullRequest {
  url: string;
  number: number;
}

export interface PullRequestDetail extends PullRequest {
  draft: boolean;
  state: 'open' | 'closed';
  merged: boolean;
  createdAt: string;
  mergedAt: string | null;
  reviews: { user: string; state: string }[];
  checks: PullRequestChecks | null;
  headSha: string | null;
  failedChecks: string[];
}

export interface NewPullRequest {
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}

export interface GitHubResponse {
  status: number;
  data: unknown;
  header(name: string): string | null;
}

export type GitHubRequest = (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, string | boolean>,
) => Promise<GitHubResponse>;

export interface GitHubConnection {
  method: GitHubMethod;
  host: string;
  get<T>(path: string, schema: z.ZodType<T>, action: string): Promise<T>;
  post<T>(
    path: string,
    body: Record<string, string>,
    schema: z.ZodType<T>,
    action: string,
  ): Promise<T>;
  whoami(): Promise<{ login: string }>;
  defaultBranch(repo: RepoRef): Promise<string>;
  findPullRequest(repo: RepoRef, head: string): Promise<PullRequest | null>;
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequestDetail>;
  createPullRequest(repo: RepoRef, pull: NewPullRequest): Promise<PullRequest>;
  updatePullRequest(
    repo: RepoRef,
    number: number,
    update: Pick<NewPullRequest, 'title' | 'body'>,
  ): Promise<PullRequest>;
}

export const GITHUB_VIA: Record<GitHubMethod, string> = {
  app: 'GitHub sign-in (GitHub App, as you)',
  token: 'saved PAT',
  gh_cli: 'gh CLI',
};

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const userSchema = z.object({ login: z.string().min(1) });
const repoSchema = z.object({ default_branch: z.string().min(1) });
const pullSchema = z.object({ html_url: z.string().url(), number: z.number().int().positive() });

const pullDetailSchema = pullSchema.extend({
  draft: z.boolean().optional(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  created_at: z.string(),
  head: z
    .object({ sha: z.string().min(1) })
    .optional()
    .catch(undefined),
});
const reviewsSchema = z.array(
  z.object({ user: z.object({ login: z.string() }).nullable(), state: z.string() }),
);

const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({
      name: z.string().optional(),
      status: z.string(),
      conclusion: z.string().nullable(),
    }),
  ),
});
type CheckRuns = z.infer<typeof checkRunsSchema>['check_runs'];

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);

const failedRuns = (runs: CheckRuns) =>
  runs.filter((run) => FAILED_CONCLUSIONS.has(run.conclusion ?? ''));

function checksOf(runs: CheckRuns): PullRequestChecks | null {
  if (runs.length === 0) return null;
  if (runs.some((run) => run.status !== 'completed')) return 'pending';
  return failedRuns(runs).length > 0 ? 'failing' : 'passing';
}

function checkFacts(runs: CheckRuns) {
  const checks = checksOf(runs);
  const failed = checks === 'failing' ? failedRuns(runs).flatMap((run) => run.name ?? []) : [];
  return { checks, failedChecks: [...new Set(failed)] };
}

const segment = (value: string) => encodeURIComponent(value);
export const repoPath = (repo: RepoRef) => `/repos/${segment(repo.owner)}/${segment(repo.name)}`;

function errorMessage(action: string, response: GitHubResponse): string {
  const detail =
    response.data && typeof response.data === 'object' && 'message' in response.data
      ? String((response.data as { message: unknown }).message)
      : '';
  if (response.status === 401) return `GitHub rejected the credentials while ${action} (401).`;
  if (response.status === 403 || response.status === 404) {
    return `GitHub denied access while ${action} (${response.status}). Check that your login or token can write to this repository.`;
  }
  return `GitHub responded with ${response.status} while ${action}${detail ? `: ${detail}` : '.'}`;
}

function parsed<T>(schema: z.ZodType<T>, action: string, response: GitHubResponse): T {
  if (response.status < 200 || response.status >= 300) {
    throw new GitHubApiError(response.status, errorMessage(action, response));
  }
  const result = schema.safeParse(response.data);
  if (!result.success)
    throw new GitHubApiError(502, `GitHub sent an unexpected answer while ${action}.`);
  return result.data;
}

const toPull = (pull: z.infer<typeof pullSchema>): PullRequest => ({
  url: pull.html_url,
  number: pull.number,
});

export function restConnection(
  method: GitHubMethod,
  host: string,
  request: GitHubRequest,
): GitHubConnection {
  async function readChecks(repo: RepoRef, sha: string | undefined) {
    if (!sha) return checkFacts([]);
    const answer = await request(
      'GET',
      `${repoPath(repo)}/commits/${segment(sha)}/check-runs?per_page=100`,
    ).catch(() => null);
    const parsed = answer && answer.status === 200 ? checkRunsSchema.safeParse(answer.data) : null;
    return checkFacts(parsed?.success ? parsed.data.check_runs : []);
  }

  return {
    method,
    host,
    async get(path, schema, action) {
      return parsed(schema, action, await request('GET', path));
    },
    async post(path, body, schema, action) {
      return parsed(schema, action, await request('POST', path, body));
    },
    async whoami() {
      return parsed(userSchema, 'checking who you are', await request('GET', '/user'));
    },
    async defaultBranch(repo) {
      const answer = await request('GET', repoPath(repo));
      return parsed(repoSchema, 'reading the repository', answer).default_branch;
    },
    async findPullRequest(repo, head) {
      const query = new URLSearchParams({ head: `${repo.owner}:${head}`, state: 'open' });
      const answer = await request('GET', `${repoPath(repo)}/pulls?${query.toString()}`);
      const pulls = parsed(z.array(pullSchema), 'looking for an open pull request', answer);
      return pulls[0] ? toPull(pulls[0]) : null;
    },
    async getPullRequest(repo, number) {
      const path = `${repoPath(repo)}/pulls/${number}`;
      const pull = parsed(pullDetailSchema, 'reading the pull request', await request('GET', path));
      const reviews = parsed(
        reviewsSchema,
        'reading the pull request reviews',
        await request('GET', `${path}/reviews?per_page=100`),
      );
      return {
        ...toPull(pull),
        draft: pull.draft ?? false,
        state: pull.state,
        merged: pull.merged ?? pull.merged_at != null,
        createdAt: pull.created_at,
        mergedAt: pull.merged_at ?? null,
        reviews: reviews.map((review) => ({
          user: review.user?.login ?? '',
          state: review.state,
        })),
        headSha: pull.head?.sha ?? null,
        ...(await readChecks(repo, pull.head?.sha)),
      };
    },
    async createPullRequest(repo, pull) {
      const answer = await request('POST', `${repoPath(repo)}/pulls`, { ...pull });
      const kind = pull.draft ? 'draft pull request' : 'pull request';
      return toPull(parsed(pullSchema, `opening the ${kind}`, answer));
    },
    async updatePullRequest(repo, number, update) {
      const answer = await request('PATCH', `${repoPath(repo)}/pulls/${number}`, update);
      return toPull(parsed(pullSchema, 'updating the pull request', answer));
    },
  };
}
