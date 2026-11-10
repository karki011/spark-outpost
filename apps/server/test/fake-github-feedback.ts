import { restConnection, type GitHubRequest } from '../src/ship/github/connection.ts';

interface Login {
  login: string;
}

export interface FakeFeedbackPull {
  owner: string;
  repo: string;
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  sha: string;
  author: string;
  checkRuns: {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    output?: { title: string; summary: string };
  }[];
  annotations: Record<number, { path: string; start_line: number; message: string }[]>;
  reviewComments: {
    id: number;
    user: Login;
    body: string;
    path: string;
    line: number;
    in_reply_to_id?: number;
  }[];
  resolvedThreads: number[];
  reviews: { id: number; user: Login; body: string; state: string }[];
  issueComments: { id: number; user: Login; body: string }[];
  requestedReviewers: Login[];
  requestedTeams: { slug: string }[];
  mergeableState: string | null;
  baseRef: string | null;
}

export interface FakeFeedbackGitHub {
  pull: FakeFeedbackPull;
  writers: Set<string>;
  posted: { path: string; body: string }[];
  reads: string[];
  request: GitHubRequest;
}

const ok = (data: unknown) => ({ status: 200, data, header: () => null });
const missing = () => ({ status: 404, data: { message: 'Not Found' }, header: () => null });

function reviewThreads(p: FakeFeedbackPull) {
  const nodes = p.reviewComments
    .filter((comment) => !comment.in_reply_to_id)
    .map((comment) => ({
      isResolved: p.resolvedThreads.includes(comment.id),
      comments: { nodes: [{ databaseId: comment.id }] },
    }));
  return { data: { repository: { pullRequest: { reviewThreads: { nodes } } } } };
}

export function fakeFeedbackGitHub(pull: Partial<FakeFeedbackPull> = {}): FakeFeedbackGitHub {
  const state: FakeFeedbackGitHub = {
    pull: {
      owner: 'acme',
      repo: 'widgets',
      number: 7,
      state: 'open',
      merged: false,
      draft: false,
      sha: 'sha-1',
      author: 'alice',
      checkRuns: [],
      annotations: {},
      reviewComments: [],
      resolvedThreads: [],
      reviews: [],
      issueComments: [],
      requestedReviewers: [],
      requestedTeams: [],
      mergeableState: null,
      baseRef: null,
      ...pull,
    },
    writers: new Set(['alice']),
    posted: [],
    reads: [],
    request: async () => missing(),
  };
  let nextId = 9000;
  state.request = async (method, path, body) => {
    const url = new URL(path, 'http://fake');
    const p = state.pull;
    const base = `/repos/${p.owner}/${p.repo}`;
    const route = url.pathname;
    state.reads.push(`${method} ${route}`);
    const page = Number(url.searchParams.get('page') ?? 1);
    const list = (items: unknown[]) => ok(page === 1 ? items : []);
    if (route === '/graphql') return ok(reviewThreads(p));
    if (method === 'POST') {
      state.posted.push({ path: route, body: String(body?.body ?? '') });
      nextId += 1;
      return { status: 201, data: { id: nextId }, header: () => null };
    }
    if (route === `${base}/pulls/${p.number}`) {
      return ok({
        state: p.state,
        draft: p.draft,
        merged: p.merged,
        merged_at: p.merged ? '2026-10-01T10:00:00Z' : null,
        head: { sha: p.sha },
        user: { login: p.author },
        mergeable_state: p.mergeableState,
        ...(p.baseRef ? { base: { ref: p.baseRef } } : {}),
        requested_reviewers: p.requestedReviewers,
        requested_teams: p.requestedTeams,
      });
    }
    if (route === `${base}/commits/${p.sha}/check-runs`) {
      return ok({ check_runs: page === 1 ? p.checkRuns : [] });
    }
    const annotations = /\/check-runs\/(\d+)\/annotations$/.exec(route);
    if (annotations) return ok(p.annotations[Number(annotations[1])] ?? []);
    if (route === `${base}/pulls/${p.number}/comments`) return list(p.reviewComments);
    if (route === `${base}/pulls/${p.number}/reviews`) return list(p.reviews);
    if (route === `${base}/issues/${p.number}/comments`) return list(p.issueComments);
    const collaborator = /\/collaborators\/([^/]+)\/permission$/.exec(route);
    if (collaborator) {
      const login = decodeURIComponent(collaborator[1]!);
      return state.writers.has(login) ? ok({ permission: 'write' }) : ok({ permission: 'read' });
    }
    return missing();
  };
  return state;
}

export function fakeConnection(fake: FakeFeedbackGitHub) {
  return restConnection('token', 'github.com', (method, path, body) =>
    fake.request(method, path, body),
  );
}
