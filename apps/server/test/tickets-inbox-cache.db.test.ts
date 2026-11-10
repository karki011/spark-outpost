import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TicketInbox } from '@spark-outpost/contracts';
import type { Db } from '../src/persistence/db.ts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { addTaskLink } from '../src/persistence/tasks.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { FRESH_WINDOW_MS } from '../src/tickets/inbox-snapshot.ts';
import { loadInbox, type InboxDeps } from '../src/tickets/inbox.ts';
import { PULL_STATUS_TTL_MS } from '../src/tickets/pull-status-cache.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import { startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, schemaDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let github: GitHubStub;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;
let clock: number;
const extraDbs: Db[] = [];

const START = Date.now();
const at = (seconds: number) => START + seconds * 1000;

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  github = await startGitHubStub();
  secrets = memorySecretStore();
  clock = START;
  app = createTestApp(t, {
    secrets,
    fetch,
    linearApiUrl: stubs.linearUrl,
    githubApiUrl: github.url,
  });
});

afterEach(async () => {
  await Promise.all(extraDbs.splice(0).map((db) => db.end()));
  await github.close();
  await stubs.close();
  await t.cleanup();
});

const send = (method: 'put' | 'post', url: string, body: object = {}) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

function depsFor(db: Db, workspaceId = t.workspaceId): InboxDeps {
  return {
    db,
    workspaceId,
    secrets,
    fetch,
    linearApiUrl: stubs.linearUrl,
    now: () => new Date(clock),
    github: {
      db,
      workspaceId,
      secrets,
      fetch,
      apiUrl: github.url,
      runCommand: async () => {
        throw new Error('No commands in this test.');
      },
      locateGh: async () => null,
    },
  };
}

const load = (options: { refresh?: boolean } = {}) => loadInbox(depsFor(t.db), options);

async function connect() {
  await send('put', '/api/tickets/connections/linear', {
    source: 'linear',
    apiKey: LINEAR_KEY,
  }).expect(200);
  await send('put', '/api/tickets/connections/jira', {
    source: 'jira',
    siteUrl: stubs.jiraUrl,
    email: JIRA_EMAIL,
    apiToken: JIRA_TOKEN,
  }).expect(200);
}

const keysOf = (inbox: TicketInbox, source: string) =>
  inbox.tickets.filter((ticket) => ticket.source === source).map((ticket) => ticket.key);

const calls = () => ({ linear: stubs.linearTraffic.calls, jira: stubs.jiraTraffic.calls });

describe('the inbox snapshot', () => {
  it('shares one sync between concurrent loads', async () => {
    await connect();
    await load();
    const before = calls();
    await load({ refresh: true });
    const single = {
      linear: stubs.linearTraffic.calls - before.linear,
      jira: stubs.jiraTraffic.calls - before.jira,
    };
    expect(single.linear).toBeGreaterThan(0);
    expect(single.jira).toBeGreaterThan(0);

    const start = calls();
    const inboxes = await Promise.all(Array.from({ length: 6 }, () => load({ refresh: true })));
    expect(stubs.linearTraffic.calls - start.linear).toBe(single.linear);
    expect(stubs.jiraTraffic.calls - start.jira).toBe(single.jira);
    expect(new Set(inboxes.map((inbox) => inbox.syncedAt)).size).toBe(1);
  });

  it('answers from the snapshot inside the window, and syncs again after it or on refresh', async () => {
    await connect();
    await load();
    const first = calls();

    clock = at(FRESH_WINDOW_MS / 1000 - 1);
    const inside = await load();
    expect(calls()).toEqual(first);
    expect(inside.syncedAt).toBe(new Date(START).toISOString());

    const refreshed = await load({ refresh: true });
    expect(stubs.linearTraffic.calls).toBeGreaterThan(first.linear);
    expect(refreshed.syncedAt).toBe(new Date(clock).toISOString());

    const second = calls();
    clock = at((FRESH_WINDOW_MS / 1000) * 2 + 1);
    await load();
    expect(stubs.linearTraffic.calls).toBeGreaterThan(second.linear);
  });

  it('shows current marks and chats from the database when it answers from the snapshot', async () => {
    await connect();
    const first = await load();
    const target = first.tickets.find((ticket) => ticket.source === 'linear')!;
    const until = new Date(clock + 3_600_000).toISOString();
    await send('put', `/api/tickets/linear/${target.key}/snooze`, {
      until,
      rules: ['blocked'],
    }).expect(200);
    const before = calls();
    const again = await load();
    expect(calls()).toEqual(before);
    expect(again.tickets.find((ticket) => ticket.key === target.key)?.snooze).toMatchObject({
      until,
    });
  });

  it('syncs again after a move, a comment, an assignment or a changed connection', async () => {
    await connect();
    await load();

    await send('post', '/api/tickets/linear/ENG-12/transition', { status: 'in_progress' }).expect(
      200,
    );
    clock = at(1);
    const moved = await load();
    expect(moved.tickets.find((ticket) => ticket.key === 'ENG-12')?.status).toBe('in_progress');

    const afterMove = calls();
    await load();
    expect(calls()).toEqual(afterMove);

    await send('post', '/api/tickets/linear/ENG-12/comments', { body: 'On it' }).expect(201);
    clock = at(2);
    await load();
    expect(stubs.linearTraffic.calls).toBeGreaterThan(afterMove.linear);

    const afterComment = calls();
    await send('post', '/api/tickets/linear/ENG-12/assign', { to: 'me' }).expect(200);
    clock = at(3);
    await load();
    expect(stubs.linearTraffic.calls).toBeGreaterThan(afterComment.linear);

    const afterAssign = calls();
    await request(app)
      .delete('/api/tickets/connections/jira')
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .expect(200);
    clock = at(4);
    const withoutJira = await load();
    expect(withoutJira.sources).toEqual(['linear']);
    expect(stubs.linearTraffic.calls).toBeGreaterThan(afterAssign.linear);
  });

  it('never shows one workspace the snapshot of another', async () => {
    await connect();
    const mine = await load();
    expect(mine.tickets.length).toBeGreaterThan(0);

    const other = randomUUID();
    await t.db.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, 'other', 'Other')`, [
      other,
    ]);
    const before = calls();
    const theirs = await loadInbox(depsFor(t.db, other));
    expect(theirs.sources).toEqual([]);
    expect(theirs.tickets).toEqual([]);
    expect(calls()).toEqual(before);

    const again = await load();
    expect(again.tickets.map((ticket) => ticket.key)).toEqual(
      mine.tickets.map((ticket) => ticket.key),
    );
  });
});

describe('a source that is limiting requests', () => {
  it('is left alone until its retry time while the other source keeps syncing, then recovers', async () => {
    await connect();
    const healthy = await load({ refresh: true });
    const jiraKeys = keysOf(healthy, 'jira');
    expect(jiraKeys.length).toBeGreaterThan(0);

    stubs.jiraTraffic.fault = { status: 429, retryAfter: '30' };
    clock = at(25);
    const limited = await load({ refresh: true });
    expect(limited.errors).toEqual([
      expect.objectContaining({
        source: 'jira',
        message: expect.stringMatching(
          /Jira is limiting requests \(429\)\. Spark is waiting until/,
        ),
      }),
    ]);
    expect(keysOf(limited, 'jira')).toEqual(jiraKeys);

    const whileWaiting = calls();
    clock = at(40);
    const waiting = await load({ refresh: true });
    expect(stubs.jiraTraffic.calls).toBe(whileWaiting.jira);
    expect(stubs.linearTraffic.calls).toBeGreaterThan(whileWaiting.linear);
    expect(waiting.errors).toHaveLength(1);
    expect(keysOf(waiting, 'jira')).toEqual(jiraKeys);
    expect(keysOf(waiting, 'linear')).toEqual(keysOf(healthy, 'linear'));

    stubs.jiraTraffic.fault = null;
    clock = at(54);
    await load({ refresh: true });
    expect(stubs.jiraTraffic.calls).toBe(whileWaiting.jira);

    clock = at(56);
    const recovered = await load({ refresh: true });
    expect(stubs.jiraTraffic.calls).toBeGreaterThan(whileWaiting.jira);
    expect(recovered.errors).toEqual([]);
    expect(keysOf(recovered, 'jira')).toEqual(jiraKeys);
  });

  it('waits a default minute when the source gives no retry time', async () => {
    await connect();
    await load({ refresh: true });
    stubs.jiraTraffic.fault = { status: 503 };
    clock = at(25);
    await load({ refresh: true });
    const asked = stubs.jiraTraffic.calls;
    clock = at(25 + 59);
    const stillWaiting = await load({ refresh: true });
    expect(stubs.jiraTraffic.calls).toBe(asked);
    expect(stillWaiting.errors[0]?.message).toMatch(/Jira is unavailable \(503\)/);
    stubs.jiraTraffic.fault = null;
    clock = at(25 + 61);
    expect((await load({ refresh: true })).errors).toEqual([]);
    expect(stubs.jiraTraffic.calls).toBeGreaterThan(asked);
  });
});

describe('pull request status and the merged move', () => {
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

  function addPull(number: number, fields: Record<string, unknown> = {}) {
    github.github.pulls.push({
      number,
      owner: 'acme',
      repo: 'widgets',
      title: 'Fix',
      body: '',
      head: `fix-${number}`,
      base: 'main',
      draft: false,
      state: 'open',
      html_url: `https://github.com/acme/widgets/pull/${number}`,
      openedBy: 'octo-token',
      via: 'token',
      ...fields,
    });
  }

  async function startChat(key: string) {
    await send('post', `/api/tickets/linear/${key}/start`, {
      conversationId: randomUUID(),
      messageId: randomUUID(),
      moveToInProgress: false,
    }).expect(201);
    await t.db.query(`UPDATE runs SET status = 'succeeded'`);
  }

  async function attachPull(key: string, url: string) {
    const { rows } = await t.db.query<{ task_id: string }>(
      'SELECT task_id FROM task_tickets WHERE ticket_key = $1',
      [key],
    );
    await addTaskLink(t.db, rows[0]!.task_id, { kind: 'pr', url, title: url, source: 'ship' });
  }

  async function linkPull(key: string, url: string) {
    await startChat(key);
    await attachPull(key, url);
  }

  const pullReads = () =>
    github.github.requests.filter((entry) => /\/pulls\/1\b/.test(entry.path)).length;
  const stateOf = (inbox: TicketInbox) =>
    inbox.tickets.find((ticket) => ticket.key === 'ENG-12')?.pullRequest?.state;

  it('reads a pull request once for a while, and again after the cache expires or on refresh', async () => {
    await connect();
    await connectGitHub();
    addPull(1, { draft: true });
    await linkPull('ENG-12', 'https://github.com/acme/widgets/pull/1');
    clock = at(0);
    expect(stateOf(await load({ refresh: true }))).toBe('draft');
    const first = pullReads();
    expect(first).toBeGreaterThan(0);

    github.github.pulls[0]!.draft = false;
    clock = at(FRESH_WINDOW_MS / 1000 + 5);
    expect(stateOf(await load())).toBe('draft');
    expect(pullReads()).toBe(first);

    clock = at(PULL_STATUS_TTL_MS / 1000 + 5);
    expect(stateOf(await load())).toBe('review');
    expect(pullReads()).toBeGreaterThan(first);

    github.github.pulls[0]!.draft = true;
    const second = pullReads();
    clock = at(PULL_STATUS_TTL_MS / 1000 + 30);
    expect(stateOf(await load({ refresh: true }))).toBe('draft');
    expect(pullReads()).toBeGreaterThan(second);
  });

  it('syncs again inside the window when a chat has attached a pull request since the snapshot', async () => {
    await connect();
    await connectGitHub();
    addPull(1, { draft: true });
    await startChat('ENG-12');
    expect(stateOf(await load({ refresh: true }))).toBeUndefined();
    const before = pullReads();

    await attachPull('ENG-12', 'https://github.com/acme/widgets/pull/1');
    clock = at(1);
    expect(stateOf(await load())).toBe('draft');
    expect(pullReads()).toBeGreaterThan(before);
  });

  it('moves a ticket whose pull request merged exactly once when several loads race', async () => {
    await connect();
    await connectGitHub();
    addPull(1, { merged: true, state: 'closed' });
    await linkPull('ENG-12', 'https://github.com/acme/widgets/pull/1');
    const { rows: schemas } = await t.db.query<{ schema: string }>(
      'SELECT current_schema() AS schema',
    );
    const second = schemaDb(schemas[0]!.schema);
    extraDbs.push(second);

    const loads = await Promise.all([
      loadInbox(depsFor(t.db), { refresh: true }),
      loadInbox(depsFor(second), { refresh: true }),
      loadInbox(depsFor(t.db), { refresh: true }),
      loadInbox(depsFor(second), { refresh: true }),
    ]);

    const { rows } = await t.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ticket_events
       WHERE action = 'transition' AND detail->>'mergedPullRequest' IS NOT NULL`,
    );
    expect(rows[0]!.count).toBe(1);
    expect(stubs.linear.issues.find((issue) => issue.identifier === 'ENG-12')!.stateId).toBe(
      'eng-done',
    );
    const settled = await load({ refresh: true });
    expect(settled.tickets.find((ticket) => ticket.key === 'ENG-12')?.section).toBe('done');
    expect(loads).toHaveLength(4);
  });
});
