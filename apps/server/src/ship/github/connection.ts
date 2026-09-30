import { z } from 'zod';
import type { GitHubMethod } from '@spark-outpost/contracts';

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
}

export interface NewPullRequest {
  title: string;
  body: string;
  head: string;
  base: string;
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
});
const reviewsSchema = z.array(
  z.object({ user: z.object({ login: z.string() }).nullable(), state: z.string() }),
);

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
  return {
    method,
    host,
    async get(path, schema, action) {
      return parsed(schema, action, await request('GET', path));
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
      };
    },
    async createPullRequest(repo, pull) {
      const answer = await request('POST', `${repoPath(repo)}/pulls`, { ...pull, draft: true });
      return toPull(parsed(pullSchema, 'opening the draft pull request', answer));
    },
    async updatePullRequest(repo, number, update) {
      const answer = await request('PATCH', `${repoPath(repo)}/pulls/${number}`, update);
      return toPull(parsed(pullSchema, 'updating the pull request', answer));
    },
  };
}
