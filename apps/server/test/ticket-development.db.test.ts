import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ticketInboxSchema,
  ticketViewSchema,
  type InboxTicket,
  type TicketView,
} from '@spark-outpost/contracts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { addTaskLink } from '../src/persistence/tasks.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import type { FakeDevPull } from './fake-jira-dev.ts';
import { repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let github: GitHubStub;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;
let base: string;

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  github = await startGitHubStub();
  secrets = memorySecretStore();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-ticket-dev-db-')));
  app = createTestApp(t, { secrets, fetch, githubApiUrl: github.url });
  await send('put', '/api/tickets/connections/jira', {
    source: 'jira',
    siteUrl: stubs.jiraUrl,
    email: JIRA_EMAIL,
    apiToken: JIRA_TOKEN,
  }).expect(200);
});

afterEach(async () => {
  await github.close();
  await stubs.close();
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

const send = (method: 'put' | 'post' | 'delete', url: string, body: object = {}) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

const pullUrl = (number: number) => `https://github.com/acme/widgets/pull/${number}`;

async function ticketIn(key: string): Promise<InboxTicket> {
  const inbox = ticketInboxSchema.parse(
    (await get('/api/tickets/inbox').set('Cache-Control', 'no-cache').expect(200)).body,
  );
  return inbox.tickets.find((ticket) => ticket.key === key)!;
}

async function viewOf(key: string): Promise<TicketView> {
  return ticketViewSchema.parse((await get(`/api/tickets/jira/${key}`).expect(200)).body);
}

async function connectGitHub() {
  await secrets.set('github', 'ghp_test_token');
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: 'octo-token',
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
}

function gitHubPull(number: number, fields: Record<string, unknown> = {}) {
  github.github.pulls.push({
    number,
    owner: 'acme',
    repo: 'widgets',
    title: `Change ${number}`,
    body: '',
    head: `change-${number}`,
    base: 'main',
    draft: false,
    state: 'open',
    html_url: pullUrl(number),
    openedBy: 'sam-teammate',
    via: 'token',
    ...fields,
  });
}

function jiraPull(number: number, fields: Partial<FakeDevPull> = {}): FakeDevPull {
  return {
    number,
    title: `Change ${number}`,
    url: pullUrl(number),
    status: 'OPEN',
    branch: `change-${number}`,
    author: 'Sam Ortiz',
    lastUpdate: '2026-09-27T12:00:00.000+0000',
    repositoryName: 'acme/widgets',
    ...fields,
  };
}

const approved = { reviews: [{ user: { login: 'rev' }, state: 'APPROVED' }] };
const devRequests = () => stubs.jira.devStatus.requests.length;

async function sparkPull(key: string, url: string) {
  await send('post', `/api/tickets/jira/${key}/start`, {
    conversationId: randomUUID(),
    messageId: randomUUID(),
    moveToInProgress: false,
  }).expect(201);
  const { rows } = await t.db.query<{ task_id: string }>(
    'SELECT task_id FROM task_tickets WHERE ticket_key = $1',
    [key],
  );
  await addTaskLink(t.db, rows[0]!.task_id, { kind: 'pr', url, title: url, source: 'ship' });
}

describe('ticket development information', () => {
  it("shows a teammate's pull request linked in Jira without asking for me", async () => {
    await connectGitHub();
    gitHubPull(7, approved);
    stubs.jira.development['WEB-418'] = {
      pullRequests: [jiraPull(7)],
      branches: [
        {
          name: 'change-7',
          url: 'https://github.com/acme/widgets/tree/change-7',
          repositoryName: 'acme/widgets',
        },
      ],
      commits: { count: 2, lastUpdated: '2026-09-27T12:10:00.000+0000' },
      builds: { count: 1, failed: 0, successful: 1 },
    };
    const ticket = await ticketIn('WEB-418');
    expect(ticket).toMatchObject({ section: 'review', reason: 'PR #7 in review', flags: [] });
    expect(ticket.pullRequest).toMatchObject({ number: 7, state: 'approved' });
    expect(ticket.development).toMatchObject({
      availability: 'ok',
      pullRequests: [
        {
          url: pullUrl(7),
          origin: 'linked',
          mine: false,
          title: 'Change 7',
          reported: 'open',
          status: { state: 'approved', author: 'sam-teammate' },
        },
      ],
      branches: [{ name: 'change-7' }],
      commits: { count: 2 },
      builds: { count: 1, failed: 0, passed: 1 },
    });
    expect((await ticketIn('WEB-419')).development).toBeUndefined();
  });

  it('raises Needs you for my own approved pull request linked in Jira', async () => {
    await connectGitHub();
    gitHubPull(8, { ...approved, openedBy: 'Octo-Token' });
    stubs.jira.development['WEB-418'] = { pullRequests: [jiraPull(8)] };
    const ticket = await ticketIn('WEB-418');
    expect(ticket.section).toBe('attention');
    expect(ticket.flags.map((flag) => flag.rule)).toEqual(['pr-approved']);
    expect(ticket.development?.pullRequests[0]).toMatchObject({ mine: true });
  });

  it('shows what Jira reported when GitHub cannot read the repository', async () => {
    stubs.jira.development['WEB-418'] = {
      pullRequests: [
        jiraPull(3, { status: 'MERGED' }),
        jiraPull(4),
        jiraPull(5, { status: 'DECLINED' }),
      ],
    };
    const ticket = await ticketIn('WEB-418');
    expect(ticket.development?.pullRequests.map((pull) => [pull.reported, pull.status])).toEqual([
      ['merged', null],
      ['open', null],
      ['declined', null],
    ]);
    expect(ticket).toMatchObject({ section: 'review', flags: [] });
    expect(ticket.pullRequest).toMatchObject({ number: 4, state: 'review', checks: null });
  });

  it('does not move a ticket to Done for a merged pull request Spark did not open', async () => {
    stubs.jira.development['WEB-418'] = { pullRequests: [jiraPull(3, { status: 'MERGED' })] };
    const ticket = await ticketIn('WEB-418');
    expect(ticket).toMatchObject({ section: 'up_next', pullRequest: null });
    expect(stubs.jira.issues.find((issue) => issue.key === 'WEB-418')!.status).toBe('To Do');
  });

  it("keeps Spark's record when Jira links the same pull request", async () => {
    await connectGitHub();
    gitHubPull(9);
    gitHubPull(10);
    await sparkPull('WEB-418', pullUrl(9));
    stubs.jira.development['WEB-418'] = { pullRequests: [jiraPull(9), jiraPull(10)] };
    const ticket = await ticketIn('WEB-418');
    expect(ticket.development?.pullRequests.map((pull) => [pull.number, pull.origin])).toEqual([
      [9, 'spark'],
      [10, 'linked'],
    ]);
    expect(ticket.pullRequest).toMatchObject({ number: 9 });
  });

  it('caches per ticket and skips tickets that are done', async () => {
    stubs.jira.development['WEB-418'] = { pullRequests: [jiraPull(4)] };
    await ticketIn('WEB-418');
    const first = devRequests();
    expect(
      stubs.jira.devStatus.requests.filter((entry) => entry.startsWith('summary')),
    ).toHaveLength(3);
    stubs.jira.development['WEB-418'] = { pullRequests: [jiraPull(4), jiraPull(6)] };
    expect((await ticketIn('WEB-418')).development?.pullRequests).toHaveLength(1);
    expect(devRequests()).toBe(first);

    await t.db.query(`UPDATE ticket_development SET fetched_at = now() - interval '11 minutes'`);
    expect((await ticketIn('WEB-418')).development?.pullRequests).toHaveLength(2);

    const beforeView = devRequests();
    await viewOf('WEB-418');
    expect(devRequests()).toBe(beforeView);
    await t.db.query(`UPDATE ticket_development SET fetched_at = now() - interval '2 minutes'`);
    await viewOf('WEB-418');
    expect(devRequests()).toBeGreaterThan(beforeView);
  });

  it.each(['forbidden', 'missing', 'malformed'] as const)(
    'still loads tickets when development information is %s, and does not retry at once',
    async (mode) => {
      stubs.jira.devStatus.mode = mode;
      const ticket = await ticketIn('WEB-418');
      expect(ticket).toMatchObject({ section: 'up_next', pullRequest: null });
      expect(ticket.development).toMatchObject({ availability: 'unavailable', pullRequests: [] });
      expect(devRequests()).toBe(3);
      await ticketIn('WEB-418');
      expect(devRequests()).toBe(3);
      const view = await viewOf('WEB-418');
      expect(view.ticket.key).toBe('WEB-418');
      expect(view.development?.availability).toBe('unavailable');
      expect(devRequests()).toBe(3);

      stubs.jira.devStatus.mode = 'ok';
      await t.db.query(`UPDATE ticket_development SET fetched_at = now() - interval '6 minutes'`);
      expect((await ticketIn('WEB-418')).development).toBeUndefined();
    },
  );

  it('stops asking after repeated failures in one refresh', async () => {
    for (let index = 0; index < 8; index += 1) {
      stubs.jira.issues.push({
        ...stubs.jira.issues.find((issue) => issue.key === 'WEB-418')!,
        key: `WEB-${900 + index}`,
        subtasks: [],
      });
    }
    stubs.jira.devStatus.mode = 'forbidden';
    await ticketIn('WEB-418');
    expect(devRequests()).toBeLessThanOrEqual(6);
    const { rows } = await t.db.query<{ outcome: string }>(
      'SELECT outcome FROM ticket_development',
    );
    expect(rows).toHaveLength(11);
    expect(rows.every((row) => row.outcome === 'unavailable')).toBe(true);
  });

  it('matches open pull requests in linked projects by key when Jira has nothing', async () => {
    await connectGitHub();
    const repo = await repoWithRemote(base, 'widgets');
    await send('post', '/api/projects', { rootPath: repo.root }).expect(201);
    gitHubPull(21, {
      head: 'feature/web-418-export',
      openedBy: 'octo-token',
      created_at: new Date().toISOString(),
    });
    gitHubPull(22, { title: 'WEB-419: header row' });
    gitHubPull(23, { head: 'web-4180', title: 'Unrelated' });
    gitHubPull(24, { head: 'api-77-mine', openedBy: 'octo-token', ...approved });
    stubs.jira.development['API-77'] = { pullRequests: [jiraPull(30, { status: 'MERGED' })] };

    const mine = await ticketIn('WEB-418');
    expect(mine.development?.pullRequests).toMatchObject([
      { number: 21, origin: 'matched', mine: true, branch: 'feature/web-418-export' },
    ]);
    expect(mine).toMatchObject({ section: 'review', pullRequest: { number: 21 } });

    const theirs = await ticketIn('WEB-419');
    expect(theirs.development?.pullRequests).toMatchObject([
      { number: 22, origin: 'matched', mine: false },
    ]);
    expect(theirs).toMatchObject({ section: 'started', pullRequest: null, flags: [] });

    const linked = await ticketIn('API-77');
    expect(linked.development?.pullRequests.map((pull) => pull.origin)).toEqual(['linked']);
    const listings = github.github.requests.filter(
      (entry) => entry.path === '/repos/acme/widgets/pulls' && entry.method === 'GET',
    );
    expect(listings).toHaveLength(1);
  });

  it('adds development to the ticket view, with pull requests from its links', async () => {
    const issue = stubs.jira.issues.find((entry) => entry.key === 'WEB-418')!;
    issue.remoteLinks.push({ globalId: pullUrl(40), url: pullUrl(40), title: 'Linked by hand' });
    stubs.jira.development['WEB-418'] = { pullRequests: [jiraPull(41)] };
    const view = await viewOf('WEB-418');
    expect(view.development?.pullRequests).toMatchObject([
      { number: 41, origin: 'linked', reported: 'open' },
      { number: 40, origin: 'linked', title: 'Linked by hand', reported: 'unknown' },
    ]);
  });

  it('forgets cached development when the source is disconnected', async () => {
    stubs.jira.development['WEB-418'] = { pullRequests: [jiraPull(4)] };
    await ticketIn('WEB-418');
    await send('delete', '/api/tickets/connections/jira').expect(200);
    const { rows } = await t.db.query('SELECT 1 FROM ticket_development');
    expect(rows).toHaveLength(0);
  });
});
