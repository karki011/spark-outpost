import { describe, expect, it } from 'vitest';
import { compareUrl, prRouteFor, pullRequestLink } from './pr-route.ts';

const github = { host: 'github.com', owner: 'acme', name: 'widgets' };
const enterprise = { host: 'git.corp.example', owner: 'acme', name: 'widgets' };

describe('choosing how Spark opens a pull request', () => {
  it.each([
    [{ hasRemote: false, repo: null, token: false, gh: false }, 'commit'],
    [{ hasRemote: true, repo: null, token: true, gh: true }, 'push'],
    [{ hasRemote: true, repo: github, token: true, gh: true }, 'token'],
    [{ hasRemote: true, repo: github, token: false, gh: true }, 'gh_cli'],
    [{ hasRemote: true, repo: github, token: false, gh: false }, 'link'],
    [{ hasRemote: true, repo: enterprise, token: false, gh: true }, 'gh_cli'],
    [{ hasRemote: true, repo: enterprise, token: false, gh: false }, 'push'],
    [{ hasRemote: true, repo: { ...github, host: 'gitlab.com' }, token: false, gh: false }, 'link'],
  ] as const)('%o → %s', (facts, route) => {
    expect(prRouteFor(facts)).toBe(route);
  });
});

describe('links to open the request by hand', () => {
  it('builds a GitHub compare URL with the title and body filled in', () => {
    const url = new URL(
      compareUrl(github, 'main', 'spark/fix-it', { title: 'ABC-1 Fix it', body: 'Fixes ABC-1' }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://github.com/acme/widgets/compare/main...spark%2Ffix-it',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      expand: '1',
      title: 'ABC-1 Fix it',
      body: 'Fixes ABC-1',
    });
  });

  it('clips a long body so the link stays usable', () => {
    const url = new URL(compareUrl(github, 'main', 'b', { title: 't', body: 'x'.repeat(10_000) }));
    expect(url.searchParams.get('body')).toHaveLength(3000);
  });

  it('links GitLab and Bitbucket merge request pages, and nothing for unknown hosts', () => {
    const text = { title: 'Fix it', body: '' };
    expect(
      pullRequestLink({ ...github, host: 'gitlab.com' }, 'main', 'spark/x', text),
    ).toMatchObject({
      url: expect.stringMatching(
        /^https:\/\/gitlab\.com\/acme\/widgets\/-\/merge_requests\/new\?merge_request%5Bsource_branch%5D=spark%2Fx/,
      ),
      label: 'Create merge request on GitLab',
    });
    expect(pullRequestLink({ ...github, host: 'bitbucket.org' }, 'main', 'spark/x', text)).toEqual({
      url: 'https://bitbucket.org/acme/widgets/pull-requests/new?source=spark%2Fx&dest=main',
      label: 'Create pull request on Bitbucket',
    });
    expect(pullRequestLink(enterprise, 'main', 'spark/x', text)).toBeNull();
    expect(pullRequestLink(github, 'main', 'spark/x', text)?.label).toBe('Create PR on GitHub');
  });
});
