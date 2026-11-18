import type { FakePull } from './fake-github.ts';

const SEARCH = (alias: string) => new RegExp(`${alias}: search\\(query: ("(?:[^"\\\\]|\\\\.)*")`);
const DEFAULT_SHA = 'e'.repeat(40);

interface Search {
  repos: Set<string>;
  since: string;
}

function searchIn(query: string, alias: string): Search | null {
  const literal = SEARCH(alias).exec(query)?.[1];
  if (!literal) return null;
  const text = JSON.parse(literal) as string;
  const repos = new Set([...text.matchAll(/repo:(\S+)/g)].map((match) => match[1]!));
  return { repos, since: /updated:>=(\S+)/.exec(text)?.[1] ?? '' };
}

function rollupState(pull: FakePull): string | null {
  const runs = pull.checkRuns ?? [];
  if (runs.length === 0) return null;
  if (runs.some((run) => run.conclusion === 'failure')) return 'FAILURE';
  if (runs.some((run) => run.status !== 'completed')) return 'PENDING';
  return 'SUCCESS';
}

function mergeFacts(pull: FakePull) {
  if (pull.mergeable_state === 'dirty')
    return { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' };
  if (pull.mergeable_state === 'behind')
    return { mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' };
  return { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
}

function node(pull: FakePull) {
  const resolved = new Set(pull.resolvedComments ?? []);
  const roots = (pull.reviewComments ?? []).filter((comment) => !comment.in_reply_to_id);
  const state = rollupState(pull);
  return {
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    isDraft: pull.draft,
    updatedAt: pull.updated_at ?? new Date().toISOString(),
    headRefName: pull.head,
    headRefOid: pull.sha ?? DEFAULT_SHA,
    additions: pull.additions ?? null,
    deletions: pull.deletions ?? null,
    changedFiles: pull.files?.length ?? null,
    reviewDecision: pull.reviewDecision ?? null,
    ...mergeFacts(pull),
    repository: { nameWithOwner: `${pull.owner}/${pull.repo}` },
    author: { __typename: 'User', login: pull.openedBy },
    reviewRequests: {
      nodes: (pull.requestedReviewers ?? []).map((login) => ({ requestedReviewer: { login } })),
    },
    latestReviews: {
      nodes: (pull.reviews ?? []).map((review) => ({
        state: review.state,
        author: { login: review.user.login },
      })),
    },
    reviewThreads: {
      nodes: roots.map((comment) => ({
        isResolved: comment.id !== undefined && resolved.has(comment.id),
      })),
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: state
              ? {
                  state,
                  contexts: {
                    nodes: (pull.checkRuns ?? []).map((run) => ({
                      status: run.status.toUpperCase(),
                      conclusion: run.conclusion?.toUpperCase() ?? null,
                    })),
                  },
                }
              : null,
          },
        },
      ],
    },
  };
}

function matching(
  pulls: readonly FakePull[],
  search: Search,
  include: (pull: FakePull) => boolean,
) {
  const nodes = pulls
    .filter((pull) => pull.state === 'open' && search.repos.has(`${pull.owner}/${pull.repo}`))
    .filter((pull) => (pull.updated_at ?? '9999').slice(0, 10) >= search.since)
    .filter(include)
    .map(node);
  return { issueCount: nodes.length, nodes };
}

export function inboxSearchAnswer(
  pulls: readonly FakePull[],
  body: Record<string, unknown>,
  login: string,
): unknown {
  const query = String(body.query ?? '');
  const review = searchIn(query, 'review');
  const mine = searchIn(query, 'mine');
  if (!review || !mine) return null;
  return {
    data: {
      viewer: { login },
      review: matching(pulls, review, (pull) => (pull.requestedReviewers ?? []).includes(login)),
      mine: matching(pulls, mine, (pull) => pull.openedBy === login),
    },
  };
}

interface FakeAnswer {
  status: number;
  body: unknown;
}

function findPull(pulls: readonly FakePull[], owner: string, repo: string, number: number) {
  return pulls.find((pull) => pull.owner === owner && pull.repo === repo && pull.number === number);
}

const REVIEW_STATES: Record<string, string> = { COMMENT: 'COMMENTED', APPROVE: 'APPROVED' };

export function reviewPostAnswer(
  pulls: readonly FakePull[],
  owner: string,
  repo: string,
  number: number,
  login: string,
  body: Record<string, unknown>,
): FakeAnswer {
  const pull = findPull(pulls, owner, repo, number);
  if (!pull) return { status: 404, body: { message: 'Not Found' } };
  const state = REVIEW_STATES[String(body.event)];
  if (!state) return { status: 422, body: { message: 'Unsupported event' } };
  const reviews = (pull.reviews ??= []);
  const id = 9000 + reviews.length;
  const html_url = `${pull.html_url}#pullrequestreview-${id}`;
  reviews.push({
    id,
    user: { login },
    state,
    body: String(body.body ?? ''),
    commit_id: String(body.commit_id ?? ''),
    html_url,
  });
  return { status: 200, body: { id, html_url } };
}

export function threadReplyAnswer(
  pulls: readonly FakePull[],
  owner: string,
  repo: string,
  number: number,
  commentId: number,
  reply: { login: string; body: Record<string, unknown> },
): FakeAnswer {
  const pull = findPull(pulls, owner, repo, number);
  const root = pull?.reviewComments?.find((comment) => comment.id === commentId);
  if (!pull || !root) return { status: 404, body: { message: 'Not Found' } };
  const id = 7000 + (pull.reviewComments ?? []).length;
  const html_url = `${pull.html_url}#discussion_r${id}`;
  pull.reviewComments!.push({
    id,
    path: root.path,
    line: root.line,
    user: { login: reply.login },
    body: String(reply.body.body ?? ''),
    in_reply_to_id: commentId,
    html_url,
  });
  return { status: 201, body: { id, html_url } };
}
