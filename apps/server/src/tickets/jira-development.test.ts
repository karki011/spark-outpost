import { describe, expect, it } from 'vitest';
import {
  devDetailBody,
  devSummaryBody,
  type FakeDevelopment,
  type FakeDevPull,
} from '../../test/fake-jira-dev.ts';
import { jiraSource } from './jira.ts';
import { parseDevDetail, parseDevSummary, readJiraDevelopment } from './jira-development.ts';
import { TicketApiError } from './source.ts';

const pull = (number: number, fields: Partial<FakeDevPull> = {}): FakeDevPull => ({
  number,
  title: `CP-1 change ${number}`,
  url: `https://github.com/acme/web/pull/${number}`,
  status: 'OPEN',
  branch: `CP-1-change-${number}`,
  author: 'Sam Ortiz',
  lastUpdate: '2026-09-27T12:00:00.000+0000',
  repositoryName: 'acme/web',
  ...fields,
});

function serving(dev: FakeDevelopment) {
  const paths: string[] = [];
  const get = async (path: string) => {
    paths.push(path);
    const url = new URL(path, 'https://jira.example.test');
    if (url.pathname.endsWith('/summary')) return devSummaryBody(dev);
    return devDetailBody(
      dev,
      url.searchParams.get('applicationType'),
      url.searchParams.get('dataType'),
    );
  };
  return { get, paths };
}

describe('Jira development information', () => {
  it('reads an open pull request with its branch, commits and builds', async () => {
    const { get, paths } = serving({
      pullRequests: [pull(12)],
      branches: [
        {
          name: 'CP-1-change-12',
          url: 'https://github.com/acme/web/tree/CP-1',
          repositoryName: 'acme/web',
        },
      ],
      commits: { count: 2, lastUpdated: '2026-09-27T12:10:00.000+0000' },
      builds: { count: 1, failed: 0, successful: 1 },
    });
    const development = await readJiraDevelopment(get, '10001');
    expect(development.pullRequests).toEqual([
      {
        url: 'https://github.com/acme/web/pull/12',
        title: 'CP-1 change 12',
        state: 'open',
        branch: 'CP-1-change-12',
        author: 'Sam Ortiz',
        updatedAt: '2026-09-27T12:00:00.000Z',
        repo: 'acme/web',
        number: 12,
      },
    ]);
    expect(development.branches).toEqual([
      { name: 'CP-1-change-12', url: 'https://github.com/acme/web/tree/CP-1', repo: 'acme/web' },
    ]);
    expect(development.commits).toEqual({ count: 2, lastAt: '2026-09-27T12:10:00.000Z' });
    expect(development.builds).toEqual({ count: 1, failed: 0, passed: 1 });
    expect(paths).toEqual([
      '/rest/dev-status/latest/issue/summary?issueId=10001',
      '/rest/dev-status/latest/issue/detail?issueId=10001&applicationType=GitHub&dataType=pullrequest',
      '/rest/dev-status/latest/issue/detail?issueId=10001&applicationType=GitHub&dataType=branch',
    ]);
  });

  it('maps merged, declined and unknown states and keeps several pull requests', async () => {
    const { get } = serving({
      pullRequests: [
        pull(1, { status: 'MERGED' }),
        pull(2, { status: 'DECLINED' }),
        pull(3),
        pull(4, { status: 'SOMETHING' as never }),
      ],
    });
    const { pullRequests } = await readJiraDevelopment(get, '10001');
    expect(pullRequests.map((entry) => entry.state)).toEqual([
      'merged',
      'declined',
      'open',
      'unknown',
    ]);
  });

  it('asks only the summary when nothing is linked', async () => {
    const { get, paths } = serving({});
    expect(await readJiraDevelopment(get, '10001')).toEqual({
      pullRequests: [],
      branches: [],
      commits: null,
      builds: null,
    });
    expect(paths).toHaveLength(1);
  });

  it('reads branches without a pull request and failing builds', async () => {
    const { get, paths } = serving({
      branches: [
        { name: 'CP-1-spike', url: 'https://github.com/acme/web/tree/s', repositoryName: 'web' },
      ],
      builds: { count: 3, failed: 2, successful: 1 },
    });
    const development = await readJiraDevelopment(get, '10001');
    expect(development.pullRequests).toEqual([]);
    expect(development.branches.map((branch) => branch.name)).toEqual(['CP-1-spike']);
    expect(development.builds).toEqual({ count: 3, failed: 2, passed: 1 });
    expect(paths.filter((path) => path.includes('dataType=pullrequest'))).toEqual([]);
  });

  it('reads a pull request on a host that is not GitHub', async () => {
    const { get } = serving({
      pullRequests: [
        pull(7, {
          url: 'https://bitbucket.org/acme/web/pull-requests/7',
          instance: 'bitbucket',
          repositoryName: 'acme/web',
        }),
      ],
    });
    const { pullRequests } = await readJiraDevelopment(get, '10001');
    expect(pullRequests[0]).toMatchObject({ repo: 'acme/web', number: 7, state: 'open' });
  });

  it('rejects answers that do not have the expected shape', () => {
    expect(() => parseDevSummary({ summary: 'none' })).toThrow(TicketApiError);
    expect(() => parseDevSummary(null)).toThrow(TicketApiError);
    expect(() =>
      parseDevSummary({ summary: { pullrequest: { overall: { count: '1' } } } }),
    ).toThrow(TicketApiError);
    expect(() => parseDevDetail({ detail: {} })).toThrow(TicketApiError);
    expect(() =>
      parseDevDetail({
        detail: [{ pullRequests: [{ url: 'javascript:alert(1)', status: 'OPEN' }] }],
      }),
    ).toThrow(TicketApiError);
  });
});

const access = { siteUrl: 'https://jira.example.test', email: 'me@example.test', apiToken: 't' };

function jiraAnswering(devStatus: (url: URL) => Response | Promise<Response>) {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname.startsWith('/rest/dev-status/')) return devStatus(url);
    return new Response(JSON.stringify({ id: '10001', key: 'CP-1' }), { status: 200 });
  }) as typeof fetch;
  return { source: jiraSource(access, { statusMap: {}, moveStatuses: {} }, fetchImpl), requests };
}

describe('Jira development requests', () => {
  it('looks the issue id up, then asks for the summary', async () => {
    const { source, requests } = jiraAnswering(() =>
      Response.json(devSummaryBody({ commits: { count: 1, lastUpdated: 'never' } })),
    );
    const development = await source.development!('CP-1');
    expect(development.commits).toEqual({ count: 1, lastAt: null });
    expect(requests).toEqual(['/rest/api/3/issue/CP-1', '/rest/dev-status/latest/issue/summary']);
  });

  it.each([403, 404, 500])('fails with the status when Jira answers %i', async (status) => {
    const { source } = jiraAnswering(() => new Response('{}', { status }));
    await expect(source.development!('CP-1')).rejects.toMatchObject({ status });
  });

  it('fails when the request times out or the answer is not JSON', async () => {
    const timedOut = jiraAnswering(() =>
      Promise.reject(new DOMException('timeout', 'TimeoutError')),
    );
    await expect(timedOut.source.development!('CP-1')).rejects.toMatchObject({ status: 0 });
    const html = jiraAnswering(() => new Response('<html>Log in</html>', { status: 200 }));
    await expect(html.source.development!('CP-1')).rejects.toMatchObject({ status: 502 });
  });
});
