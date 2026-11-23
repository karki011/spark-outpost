import { describe, expect, it } from 'vitest';
import { inboxQuery, parseInboxPage, repoChunks, reviewQuery } from './search.ts';

const HEAD = 'c'.repeat(40);

function node(fields: Record<string, unknown> = {}) {
  return {
    number: 12,
    title: 'Add a gadget',
    url: 'https://github.com/acme/widgets/pull/12',
    isDraft: false,
    updatedAt: '2026-11-15T10:00:00Z',
    createdAt: '2026-11-12T08:00:00Z',
    headRefName: 'WEB-7-gadget',
    baseRefName: 'main',
    bodyText: 'Adds the gadget.',
    labels: { nodes: [{ name: 'feature', color: 'a2eeef' }, { name: 'odd', color: 'nope' }, null] },
    assignees: { nodes: [{ login: 'carol' }, null] },
    comments: { totalCount: 5 },
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
    viewerLatestReview: { state: 'COMMENTED' },
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
    const parsed = parseInboxPage(page([node()], []), 'review');
    expect(parsed.viewer).toBe('hazel');
    expect(parsed.error).toBeNull();
    expect(parsed.pulls).toEqual([
      expect.objectContaining({
        repo: 'acme/widgets',
        number: 12,
        author: 'alice',
        authorIsBot: false,
        headRef: 'WEB-7-gadget',
        baseRef: 'main',
        createdAt: '2026-11-12T08:00:00Z',
        bodyPreview: 'Adds the gadget.',
        labels: [
          { name: 'feature', color: 'a2eeef' },
          { name: 'odd', color: null },
        ],
        assignees: ['carol'],
        comments: 5,
        headSha: HEAD,
        requestedReviewers: ['hazel'],
        reviews: [{ login: 'bob', state: 'COMMENTED' }],
        viewerReview: 'COMMENTED',
        unresolvedThreads: 1,
        checks: 'failing',
        failingChecks: 1,
        reviewRequested: true,
      }),
    ]);
  });

  it('cuts a long description preview and falls back when the new fields are missing', () => {
    const parsed = parseInboxPage(
      page(
        [
          node({
            bodyText: 'x'.repeat(5_000),
            createdAt: undefined,
            baseRefName: null,
            labels: null,
            assignees: 'x',
            comments: null,
          }),
        ],
        [],
      ),
      'review',
    );
    expect(parsed.pulls[0]).toMatchObject({
      createdAt: '2026-11-15T10:00:00Z',
      baseRef: '',
      labels: [],
      assignees: [],
      comments: null,
    });
    expect(parsed.pulls[0]?.bodyPreview).toHaveLength(2_000);
  });

  it('marks pull requests found by the reviewed search', () => {
    const parsed = parseInboxPage(
      { data: { viewer: { login: 'hazel' }, reviewed: { issueCount: 1, nodes: [node()] } } },
      'reviewed',
    );
    expect(parsed.pulls[0]).toMatchObject({ reviewRequested: false, reviewedByViewer: true });
  });

  it('drops a malformed node and keeps the good ones', () => {
    const parsed = parseInboxPage(
      page([node({ headRefOid: 'not-a-sha' }), node({ number: 13 }), {}], []),
      'review',
    );
    expect(parsed.pulls.map((pull) => pull.number)).toEqual([13]);
  });

  it('tolerates fields GitHub refused to give', () => {
    const parsed = parseInboxPage(
      page([], [node({ commits: null, reviewThreads: 'x', author: null, additions: -1 })]),
      'mine',
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
      'review',
    );
    const suffixed = parseInboxPage(page([node({ author: { login: 'ci[bot]' } })], []), 'review');
    expect(bot.pulls[0]?.authorIsBot).toBe(true);
    expect(suffixed.pulls[0]?.authorIsBot).toBe(true);
  });

  it('reports a refused search and an unexpected answer without throwing', () => {
    expect(
      parseInboxPage({ data: null, errors: [{ message: 'Bad credentials' }] }, 'review').error,
    ).toBe('GitHub refused the search: Bad credentials');
    expect(parseInboxPage('nonsense', 'review').error).toBe(
      'GitHub sent an unexpected answer to the search.',
    );
    expect(
      parseInboxPage({ data: { viewer: null, review: null, mine: 7 } }, 'review'),
    ).toMatchObject({
      pulls: [],
      error: 'GitHub left part of the search unanswered.',
    });
  });

  it('notes a search with more results than it returned', () => {
    const body = page([node()], []);
    body.data.review.issueCount = 80;
    expect(parseInboxPage(body, 'review').truncated).toBe(true);
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
      const search = /mine: search\(query: ("(?:[^"\\]|\\.)*")/.exec(
        inboxQuery(chunk, '2026-11-02'),
      );
      expect((JSON.parse(search![1]!) as string).length).toBeLessThanOrEqual(256);
    }
  });

  it('asks for review requests in every repository and for own pull requests in the linked ones', () => {
    const searchOf = (query: string) =>
      JSON.parse(/search\(query: ("(?:[^"\\]|\\.)*")/.exec(query)![1]!) as string;
    const review = searchOf(reviewQuery('review', '2026-11-02'));
    const mine = searchOf(inboxQuery([{ owner: 'acme', name: 'widgets' }], '2026-11-02'));
    expect(review).toContain('review-requested:@me');
    expect(review).toContain('updated:>=2026-11-02');
    expect(review).not.toContain('repo:');
    const reviewed = searchOf(reviewQuery('reviewed', '2026-11-02'));
    expect(reviewed).toContain('reviewed-by:@me -author:@me');
    expect(reviewed).not.toContain('repo:');
    expect(mine).toContain('author:@me');
    expect(mine).toContain('repo:acme/widgets');
  });

  it('asks one search per query, a page at a time, and passes the cursor GitHub gave', () => {
    const first = reviewQuery('review', '2026-11-02');
    expect(first).toMatch(/review: search\(.*first: 15\)/);
    expect(first).not.toContain('reviewed:');
    expect(first).not.toContain('after:');
    expect(reviewQuery('reviewed', '2026-11-02', 'Y3Vyc29y"x')).toContain('after: "Y3Vyc29y\\"x"');
    const body = page([node()], []);
    expect(parseInboxPage(body, 'review').next).toBeNull();
    Object.assign(body.data.review, { pageInfo: { hasNextPage: true, endCursor: 'abc' } });
    expect(parseInboxPage(body, 'review').next).toBe('abc');
  });

  it('reads only the search it asked for', () => {
    const body = page([node()], [node({ number: 13 })]);
    expect(parseInboxPage(body, 'review').pulls.map((pull) => pull.number)).toEqual([12]);
    expect(parseInboxPage(body, 'mine').pulls.map((pull) => pull.number)).toEqual([13]);
    const mineOnly = { data: { viewer: { login: 'hazel' }, mine: { issueCount: 0, nodes: [] } } };
    expect(parseInboxPage(mineOnly, 'mine').error).toBeNull();
    expect(parseInboxPage(mineOnly, 'review').error).toBe(
      'GitHub left part of the search unanswered.',
    );
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
