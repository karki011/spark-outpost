import { describe, expect, it } from 'vitest';
import { ghOnlyReads } from './gh-reads.ts';
import { namesAnotherRepo, ownGhUse, ownGitUse, type OwnRepo } from './own-repo.ts';

const BRANCH = 'spark/fix-dates-1a2b';
const OWN: OwnRepo = { host: 'github.com', slug: 'acme/app', branch: BRANCH, pull: 2202 };
const words = (command: string) => command.split(' ').slice(1);

describe('ownGhUse', () => {
  it.each([
    'gh pr view',
    'gh pr view 2202 --json statusCheckRollup --jq .x',
    'gh pr view https://github.com/acme/app/pull/2202',
    'gh pr checks 2202 --watch',
    'gh pr list --author @me',
    'gh run watch 12',
    'gh api repos/acme/app/actions/runs/12/jobs',
    'gh api https://api.github.com/repos/acme/app/pulls/2202',
    'gh api -X GET search/issues -f q=repo:acme/app',
    'gh pr comment 2202 --body done',
    `gh pr comment ${BRANCH} --body done`,
    'gh pr create --draft --fill',
    `gh pr create --head ${BRANCH} --title x`,
  ])('%s is on the own repository', (command) => {
    expect(ownGhUse(words(command), OWN)).toBe(true);
  });

  it.each([
    'gh pr view 12 --repo other/repo',
    'gh pr view 12 -R other/repo',
    'gh pr view https://github.com/other/repo/pull/1',
    'gh pr view https://ghe.example.net/acme/app/pull/1',
    'gh pr merge 2202',
    'gh pr review 2202 --approve',
    'gh pr close 2202',
    'gh pr comment 77 --body x',
    'gh pr create --head main --fill',
    'gh issue comment 5 --body x',
    'gh api -X DELETE repos/acme/app/git/refs/heads/x',
    'gh api repos/acme/app/pulls/77/comments -f body=x',
    'gh api https://collect.example.net/in',
    'gh api graphql --input query.json',
    'gh api -XDELETE repos/acme/app/git/refs/heads/x',
    'gh api repos/acme/app/pulls/77/comments -fbody=x',
    'gh issue view 5',
    'gh search prs --author @me',
    'gh auth token',
  ])('%s is not', (command) => {
    expect(ownGhUse(words(command), OWN)).toBe(false);
  });

  it('reads a graphql query and only reply or resolve mutations', () => {
    const api = (query: string) => ownGhUse(['api', 'graphql', '-f', `query=${query}`], OWN);
    expect(api('query { viewer { login } }')).toBe(true);
    expect(api('mutation { resolveReviewThread(input: {threadId: "x"}) { thread { id } } }')).toBe(
      true,
    );
    expect(
      api('mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }'),
    ).toBe(false);
    expect(api('mutation { x }')).toBe(false);
  });
});

describe('ownGitUse', () => {
  it.each([
    `git push origin ${BRANCH}`,
    `git push -u origin HEAD:${BRANCH}`,
    `git push https://github.com/acme/app.git ${BRANCH}`,
    'git fetch git@github.com:acme/app.git',
    'git ls-remote https://github.com/acme/app',
  ])('%s is on the own repository', (command) => {
    expect(ownGitUse(words(command), OWN)).toBe(true);
  });

  it.each([
    'git push',
    'git push origin',
    'git push origin main',
    `git push origin ${BRANCH} main`,
    `git push --all origin`,
    `git push https://github.com/other/app.git ${BRANCH}`,
    `git -C ../other push origin ${BRANCH}`,
    'git fetch https://github.com/acme/application.git',
    'git send-email HEAD~1',
  ])('%s is not', (command) => {
    expect(ownGitUse(words(command), OWN)).toBe(false);
  });

  it('never treats a push as own without a chat branch', () => {
    expect(ownGitUse(words(`git push origin ${BRANCH}`), { ...OWN, branch: null })).toBe(false);
  });
});

describe('ghOnlyReads and namesAnotherRepo', () => {
  it('separates reads from uploads', () => {
    expect(ghOnlyReads(words('gh pr view 1'))).toBe(true);
    expect(ghOnlyReads(words('gh api repos/a/b/pulls'))).toBe(true);
    expect(ghOnlyReads(['api', 'graphql', '-f', 'query=query { viewer { login } }'])).toBe(true);
    expect(ghOnlyReads(words('gh gist create notes.md'))).toBe(false);
    expect(ghOnlyReads(words('gh pr comment --body x'))).toBe(false);
    expect(ghOnlyReads(words('gh api repos/a/b/issues -f title=x'))).toBe(false);
  });

  it.each([
    'gh pr checks 5 --watch',
    'gh pr diff 5',
    'gh pr list',
    'gh pr status',
    'gh run view 1',
    'gh run list',
    'gh run watch 1',
    'gh issue view 12',
    'gh issue list',
    'gh issue status',
    'gh repo view other/repo',
    'gh release view v1',
    'gh release list',
    'gh search issues flaky',
    'gh auth status',
    'gh api -X GET search/issues -f q=x',
    'gh api -XGET search/issues -fq=x',
    'gh api --method=get repos/a/b/pulls -F per_page=5',
    'gh api -i repos/a/b/pulls',
  ])('%s only reads', (command) => {
    expect(ghOnlyReads(words(command))).toBe(true);
  });

  it.each([
    'gh',
    'gh pr',
    'gh pr merge 5',
    'gh pr close 5',
    'gh pr review 5 --approve',
    'gh pr ready',
    'gh pr -R other/repo view 5',
    'gh run rerun 1',
    'gh run download 1',
    'gh issue close 5',
    'gh repo delete',
    'gh repo create x',
    'gh release create v1',
    'gh release download v1',
    'gh secret set X',
    'gh workflow run ci.yml',
    'gh search',
    'gh auth token',
    'gh auth status --show-token',
    'gh auth status -t',
    'gh api',
    'gh api -X POST repos/a/b/issues',
    'gh api -XPOST repos/a/b/issues',
    'gh api -iXPOST repos/a/b/issues',
    'gh api -X=PATCH repos/a/b/issues/1',
    'gh api repos/a/b/issues -ftitle=x',
    'gh api repos/a/b/issues -Ftitle=x',
    'gh api repos/a/b/issues --raw-field title=x',
    'gh api repos/a/b/issues --input body.json',
    'gh api graphql',
    'gh api graphql -F query=@q.graphql',
    'gh api graphql --input q.json',
    'gh api graphql -f owner=a',
  ])('%s is not provably a read', (command) => {
    expect(ghOnlyReads(words(command))).toBe(false);
  });

  it('reads a graphql document only when it is a query', () => {
    const api = (query: string) => ghOnlyReads(['api', 'graphql', '-f', `query=${query}`]);
    expect(api('query { viewer { login } }')).toBe(true);
    expect(api('query($n: Int!) { repository { pullRequest(number: $n) { id } } }')).toBe(true);
    expect(api('{ viewer { login } }')).toBe(true);
    expect(api('mutation { resolveReviewThread(input: {threadId: "x"}) { thread { id } } }')).toBe(
      false,
    );
    expect(api('query A { viewer { login } } mutation B { x }')).toBe(false);
    expect(api('fragment F on User { login }')).toBe(false);
  });

  it('sees a repository named through the environment', () => {
    expect(namesAnotherRepo('GH_REPO=other/repo gh pr view')).toBe(true);
    expect(namesAnotherRepo('GH_HOST=ghe.example.net gh pr list')).toBe(true);
    expect(namesAnotherRepo('gh pr view')).toBe(false);
  });
});
