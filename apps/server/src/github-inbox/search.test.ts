import { describe, expect, it } from 'vitest';
import { inboxQuery, parseInboxPage, repoChunks } from './search.ts';

const HEAD = 'c'.repeat(40);

function node(fields: Record<string, unknown> = {}) {
  return {
    number: 12,
    title: 'Add a gadget',
    url: 'https://github.com/acme/widgets/pull/12',
    isDraft: false,
    updatedAt: '2026-11-15T10:00:00Z',
    headRefName: 'WEB-7-gadget',
    headRefOid: HEAD,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    repository: { nameWithOwner: 'acme/widgets' },
    author: { __typename: 'User', login: 'alice' },
    reviewRequests: {
      nodes: [{ requestedReviewer: { login: 'hazel' } }, { requestedReviewer: {} }],
    },
    latestReviews: { nodes: [{ state: 'COMMENTED', author: { login: 'bob' } }] },
    reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: 'FAILURE',
              contexts: {
                nodes: [
                  { status: 'COMPLETED', conclusion: 'FAILURE' },
                  { status: 'COMPLETED', conclusion: 'SUCCESS' },
                  {},
                ],
              },
            },
          },
        },
      ],
    },
    ...fields,
  };
}

const page = (review: unknown[], mine: unknown[], extra: Record<string, unknown> = {}) => ({
  data: {
    viewer: { login: 'hazel' },
    review: { issueCount: review.length, nodes: review },
    mine: { issueCount: mine.length, nodes: mine },
    ...extra,
  },
});

describe('parsing the inbox search', () => {
  it('reads the facts of a pull request', () => {
    const parsed = parseInboxPage(page([node()], []));
    expect(parsed.viewer).toBe('hazel');
    expect(parsed.error).toBeNull();
    expect(parsed.pulls).toEqual([
      expect.objectContaining({
        repo: 'acme/widgets',
        number: 12,
        author: 'alice',
        authorIsBot: false,
        headRef: 'WEB-7-gadget',
        headSha: HEAD,
        requestedReviewers: ['hazel'],
        reviews: [{ login: 'bob', state: 'COMMENTED' }],
        unresolvedThreads: 1,
        checks: 'failing',
        failingChecks: 1,
        reviewRequested: true,
      }),
    ]);
  });

  it('drops a malformed node and keeps the good ones', () => {
    const parsed = parseInboxPage(
      page([node({ headRefOid: 'not-a-sha' }), node({ number: 13 }), {}], [node({ url: 5 })]),
    );
    expect(parsed.pulls.map((pull) => pull.number)).toEqual([13]);
  });

  it('tolerates fields GitHub refused to give', () => {
    const parsed = parseInboxPage(
      page([], [node({ commits: null, reviewThreads: 'x', author: null, additions: -1 })]),
    );
    expect(parsed.pulls[0]).toMatchObject({
      checks: null,
      failingChecks: 0,
      unresolvedThreads: null,
      author: 'ghost',
      additions: null,
      reviewRequested: false,
    });
  });

  it('marks a bot author', () => {
    const bot = parseInboxPage(
      page([node({ author: { __typename: 'Bot', login: 'renovate' } })], []),
    );
    const suffixed = parseInboxPage(page([node({ author: { login: 'ci[bot]' } })], []));
    expect(bot.pulls[0]?.authorIsBot).toBe(true);
    expect(suffixed.pulls[0]?.authorIsBot).toBe(true);
  });

  it('reports a refused search and an unexpected answer without throwing', () => {
    expect(parseInboxPage({ data: null, errors: [{ message: 'Bad credentials' }] }).error).toBe(
      'GitHub refused the search: Bad credentials',
    );
    expect(parseInboxPage('nonsense').error).toBe(
      'GitHub sent an unexpected answer to the search.',
    );
    expect(parseInboxPage({ data: { viewer: null, review: null, mine: 7 } })).toMatchObject({
      pulls: [],
      error: 'GitHub left part of the search unanswered.',
    });
  });

  it('notes a search with more results than it returned', () => {
    const body = page([node()], []);
    body.data.review.issueCount = 80;
    expect(parseInboxPage(body).truncated).toBe(true);
  });
});

describe('the inbox query', () => {
  it('splits many repositories into searches GitHub accepts', () => {
    const repos = Array.from({ length: 20 }, (_, index) => ({
      owner: 'acme-corporation',
      name: `service-number-${index}`,
    }));
    const chunks = repoChunks(repos, '2026-11-02');
    expect(chunks.flat()).toHaveLength(20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const search = /review: search\(query: ("(?:[^"\\]|\\.)*")/.exec(
        inboxQuery(chunk, '2026-11-02'),
      );
      expect((JSON.parse(search![1]!) as string).length).toBeLessThanOrEqual(256);
    }
  });

  it('leaves out a repository name that could change the query', () => {
    const chunks = repoChunks(
      [
        { owner: 'acme', name: 'widgets' },
        { owner: 'acme', name: 'x") { evil }' },
      ],
      '2026-11-02',
    );
    expect(chunks).toEqual([[{ owner: 'acme', name: 'widgets' }]]);
  });
});
