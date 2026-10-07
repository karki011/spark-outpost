export type DevStatusMode = 'ok' | 'forbidden' | 'missing' | 'malformed';

export interface FakeDevPull {
  number: number;
  title: string;
  url: string;
  status: 'OPEN' | 'MERGED' | 'DECLINED';
  branch: string;
  author: string;
  lastUpdate: string;
  repositoryName: string;
  instance?: string;
}

export interface FakeDevBranch {
  name: string;
  url: string;
  repositoryName: string;
  instance?: string;
}

export interface FakeDevelopment {
  pullRequests?: FakeDevPull[];
  branches?: FakeDevBranch[];
  commits?: { count: number; lastUpdated: string };
  builds?: { count: number; failed: number; successful: number };
}

const DEFAULT_INSTANCE = 'GitHub';
const instanceOf = (entry: { instance?: string }) => entry.instance ?? DEFAULT_INSTANCE;

function byInstance(entries: readonly { instance?: string }[]) {
  const counts: Record<string, { count: number; name: string }> = {};
  for (const entry of entries) {
    const name = instanceOf(entry);
    counts[name] = { count: (counts[name]?.count ?? 0) + 1, name };
  }
  return counts;
}

export function devSummaryBody(dev: FakeDevelopment) {
  const pulls = dev.pullRequests ?? [];
  const branches = dev.branches ?? [];
  const commits = dev.commits ?? { count: 0, lastUpdated: null };
  const builds = dev.builds ?? { count: 0, failed: 0, successful: 0 };
  return {
    errors: [],
    configErrors: [],
    summary: {
      pullrequest: {
        overall: {
          count: pulls.length,
          lastUpdated: pulls[0]?.lastUpdate ?? null,
          stateCount: pulls.length,
          state: pulls[0]?.status ?? 'OPEN',
          dataType: 'pullrequest',
          open: pulls.some((pull) => pull.status === 'OPEN'),
        },
        byInstanceType: byInstance(pulls),
      },
      build: {
        overall: {
          count: builds.count,
          lastUpdated: null,
          failedBuildCount: builds.failed,
          successfulBuildCount: builds.successful,
          unknownBuildCount: 0,
          dataType: 'build',
        },
        byInstanceType: builds.count > 0 ? { cloud: { count: builds.count, name: 'Other' } } : {},
      },
      review: { overall: { count: 0, lastUpdated: null, dataType: 'review' }, byInstanceType: {} },
      repository: {
        overall: { count: commits.count, lastUpdated: commits.lastUpdated, dataType: 'repository' },
        byInstanceType:
          commits.count > 0 ? { GitHub: { count: commits.count, name: 'GitHub' } } : {},
      },
      branch: {
        overall: { count: branches.length, lastUpdated: null, dataType: 'branch' },
        byInstanceType: byInstance(branches),
      },
    },
  };
}

export function devDetailBody(dev: FakeDevelopment, type: string | null, dataType: string | null) {
  const pulls = (dev.pullRequests ?? []).filter((pull) => instanceOf(pull) === type);
  const branches = (dev.branches ?? []).filter((branch) => instanceOf(branch) === type);
  return {
    errors: [],
    detail: [
      {
        branches: branches.map((branch) => ({
          name: branch.name,
          url: branch.url,
          createPullRequestUrl: `${branch.url}/compare`,
          repository: { name: branch.repositoryName, url: branch.url },
        })),
        pullRequests:
          dataType === 'pullrequest'
            ? pulls.map((pull) => ({
                author: { name: pull.author, avatar: 'https://avatars.example.test/a.png' },
                id: `#${pull.number}`,
                name: pull.title,
                commentCount: 0,
                source: { branch: pull.branch, url: `${pull.url}/branch` },
                destination: { branch: 'main', url: pull.url },
                reviewers: [],
                status: pull.status,
                url: pull.url,
                lastUpdate: pull.lastUpdate,
                repositoryName: pull.repositoryName,
              }))
            : [],
        repositories: [],
        _instance: { name: type, type },
      },
    ],
  };
}
