import type { FakePull } from './fake-github.ts';

export interface FakeAnswer {
  status: number;
  body: unknown;
}

const READ =
  /^\/repos\/([^/]+)\/([^/]+)\/(?:pulls\/(\d+)\/(files|comments)|issues\/(\d+)\/comments|commits\/([^/]+)\/check-runs)$/;

export const fakeSha = (pull: FakePull) => pull.sha ?? `sha-${pull.number}`;

export function pullJson(pull: FakePull) {
  return {
    number: pull.number,
    title: pull.title,
    body: pull.body,
    html_url: pull.html_url,
    state: pull.state,
    draft: pull.draft,
    user: { login: pull.openedBy },
    head: { ref: pull.head, sha: fakeSha(pull) },
    base: { ref: pull.base },
    merged: pull.merged ?? false,
    merged_at: pull.merged ? '2026-09-28T09:00:00Z' : null,
    created_at: pull.created_at ?? '2026-09-25T09:00:00Z',
    updated_at: pull.updated_at ?? pull.created_at ?? '2026-09-25T09:00:00Z',
    mergeable: pull.mergeable === undefined ? true : pull.mergeable,
    mergeable_state: pull.mergeable_state ?? 'clean',
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changed_files: pull.files?.length ?? 0,
    comments: pull.issueComments?.length ?? 0,
    review_comments: pull.reviewComments?.length ?? 0,
  };
}

function paged<T>(items: readonly T[], query: URLSearchParams): T[] {
  const perPage = Number(query.get('per_page') ?? 30);
  const page = Number(query.get('page') ?? 1);
  return items.slice((page - 1) * perPage, page * perPage);
}

export function listPullsAnswer(
  pulls: readonly FakePull[],
  owner: string,
  repo: string,
  query: URLSearchParams,
): FakeAnswer {
  const head = query.get('head');
  const state = query.get('state') ?? 'open';
  const matching = pulls
    .filter((pull) => pull.owner === owner && pull.repo === repo)
    .filter((pull) => (head ? `${pull.owner}:${pull.head}` === head : true))
    .filter((pull) => state === 'all' || pull.state === state)
    .toSorted((a, b) => b.number - a.number);
  return { status: 200, body: paged(matching, query).map(pullJson) };
}

export function pullReadAnswer(
  pulls: readonly FakePull[],
  pathname: string,
  query: URLSearchParams,
): FakeAnswer | null {
  const match = READ.exec(pathname);
  if (!match) return null;
  const [, owner, repo, pullNumber, kind, issueNumber, sha] = match;
  const inRepo = pulls.filter((pull) => pull.owner === owner && pull.repo === repo);
  if (sha) {
    const pull = inRepo.find((entry) => fakeSha(entry) === sha);
    const runs = pull?.checks ?? [];
    return { status: 200, body: { total_count: runs.length, check_runs: runs } };
  }
  const number = Number(pullNumber ?? issueNumber);
  const pull = inRepo.find((entry) => entry.number === number);
  if (!pull) return { status: 404, body: { message: 'Not Found' } };
  if (issueNumber) return { status: 200, body: paged(pull.issueComments ?? [], query) };
  if (kind === 'files') return { status: 200, body: paged(pull.files ?? [], query) };
  return { status: 200, body: paged(pull.reviewComments ?? [], query) };
}
