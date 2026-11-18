import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubInboxSchema, type GithubInbox } from '@spark-outpost/contracts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import {
  inboxSeenMarks,
  inboxWindowDays,
  markInboxSeen,
  saveInboxWindowDays,
} from '../src/persistence/github-inbox.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { TOKEN_LOGIN, type FakePull } from './fake-github.ts';
import { repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);
const DAY = 24 * 60 * 60_000;

let t: TestDb;
let github: GitHubStub;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;
let base: string;

beforeEach(async () => {
  t = await createTestDb();
  github = await startGitHubStub();
  secrets = memorySecretStore();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-github-inbox-')));
  app = createTestApp(t, { secrets, fetch, githubApiUrl: github.url });
});

afterEach(async () => {
  await github.close();
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

const send = (method: 'put' | 'post', url: string, body: object = {}) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

async function inbox(query = ''): Promise<GithubInbox> {
  const answer = await request(app).get(`/api/github/inbox${query}`).set(LOCAL_HEADERS).expect(200);
  return githubInboxSchema.parse(answer.body);
}

async function connectGitHub() {
  await secrets.set('github', 'ghp_test_token');
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: TOKEN_LOGIN,
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
}

async function linkWidgets(): Promise<string> {
  const repo = await repoWithRemote(base, 'widgets');
  const created = await send('post', '/api/projects', { rootPath: repo.root }).expect(201);
  return (created.body as { id: string }).id;
}

function pull(number: number, fields: Partial<FakePull> = {}) {
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
    html_url: `https://github.com/acme/widgets/pull/${number}`,
    openedBy: TOKEN_LOGIN,
    via: 'token',
    sha: SHA,
    updated_at: new Date().toISOString(),
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
    ...fields,
  });
}

const searches = () =>
  github.github.requests.filter((entry) => entry.path === '/graphql' && entry.method === 'POST')
    .length;

const groups = (shown: GithubInbox) =>
  Object.fromEntries(shown.items.map((item) => [item.number, item.group]));

describe('the GitHub inbox', () => {
  it('is not connected without a GitHub connection', async () => {
    expect(await inbox()).toEqual({
      connected: false,
      login: null,
      windowDays: 14,
      fetchedAt: null,
      items: [],
      problems: [],
    });
  });

  it('groups open pull requests in linked projects', async () => {
    await connectGitHub();
    const projectId = await linkWidgets();
    pull(1, { openedBy: 'alice', requestedReviewers: [TOKEN_LOGIN] });
    pull(2);
    pull(3, { checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] });
    pull(4, { mergeable_state: 'dirty' });
    pull(5, { draft: true });
    pull(6, { reviewDecision: 'REVIEW_REQUIRED', requestedReviewers: ['bob'] });
    pull(7, { openedBy: 'alice' });
    pull(8, { owner: 'other', repo: 'elsewhere' });
    pull(9, { updated_at: new Date(Date.now() - 20 * DAY).toISOString() });

    const shown = await inbox();
    expect(shown).toMatchObject({
      connected: true,
      login: TOKEN_LOGIN,
      windowDays: 14,
      problems: [],
    });
    expect(groups(shown)).toEqual({
      1: 'review_requested',
      2: 'ready_to_merge',
      3: 'needs_fixes',
      4: 'needs_fixes',
      5: 'waiting',
      6: 'waiting',
    });
    expect(shown.items.find((item) => item.number === 1)).toMatchObject({
      id: 'acme/widgets#1',
      author: 'alice',
      mine: false,
      unseen: true,
      projectId,
      conversationId: null,
      ticket: null,
    });
    expect(shown.items.find((item) => item.number === 6)?.waitingOn).toEqual(['bob']);
  });

  it('fills the chat that watches a pull request and a known ticket named in its branch', async () => {
    await connectGitHub();
    await linkWidgets();
    pull(11, { head: 'feature/web-418-export' });
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    await t.db.query(
      `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url, branch)
       VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', 11, $4, 'feature/web-418-export')`,
      [randomUUID(), t.workspaceId, conversation.id, 'https://github.com/acme/widgets/pull/11'],
    );
    await t.db.query(
      `INSERT INTO ticket_connections (workspace_id, source, api_url, account)
       VALUES ($1, 'jira', 'https://jira.example.test', 'me')`,
      [t.workspaceId],
    );
    await t.db.query(
      `INSERT INTO tickets (workspace_id, source, key, title, status, status_name, url, updated_at)
       VALUES ($1, 'jira', 'WEB-418', 'Export', 'in_progress', 'In Progress', 'https://jira.example.test/WEB-418', now())`,
      [t.workspaceId],
    );

    const [item] = (await inbox()).items;
    expect(item).toMatchObject({
      conversationId: conversation.id,
      ticket: {
        source: 'jira',
        key: 'WEB-418',
        title: 'Export',
        status: 'In Progress',
        url: 'https://jira.example.test/WEB-418',
      },
    });
  });

  it('caches for two minutes, refreshes on request and shows a seen mark at once', async () => {
    await connectGitHub();
    await linkWidgets();
    pull(1, { openedBy: 'alice', requestedReviewers: [TOKEN_LOGIN] });

    expect((await inbox()).items[0]?.unseen).toBe(true);
    expect(searches()).toBe(1);
    const seen = await send('post', '/api/github/inbox/seen', {
      id: 'acme/widgets#1',
      headSha: SHA,
    }).expect(200);
    expect(githubInboxSchema.parse(seen.body).items[0]).toMatchObject({
      unseen: false,
      updatedSinceSeen: false,
    });
    expect(searches()).toBe(1);

    github.github.pulls[0]!.sha = NEW_SHA;
    expect((await inbox()).items[0]?.headSha).toBe(SHA);
    const refreshed = await inbox('?refresh=1');
    expect(searches()).toBe(2);
    expect(refreshed.items[0]).toMatchObject({
      headSha: NEW_SHA,
      unseen: false,
      updatedSinceSeen: true,
    });
  });

  it('keeps the last good result and reports the problem when GitHub refuses', async () => {
    await connectGitHub();
    await linkWidgets();
    pull(2);
    const good = await inbox();
    github.github.searchFailure = { status: 403, message: 'API rate limit exceeded' };

    const limited = await inbox('?refresh=1');
    expect(limited.items.map((item) => item.number)).toEqual([2]);
    expect(limited.fetchedAt).toBe(good.fetchedAt);
    expect(limited.problems).toEqual([
      { repo: 'acme/widgets', message: expect.stringContaining('403') },
    ]);
  });

  it('stores the window and searches only that far back', async () => {
    await connectGitHub();
    await linkWidgets();
    pull(9, { updated_at: new Date(Date.now() - 20 * DAY).toISOString() });

    const wide = await send('put', '/api/github/inbox/window', { windowDays: 30 }).expect(200);
    expect(githubInboxSchema.parse(wide.body)).toMatchObject({ windowDays: 30 });
    expect(groups(githubInboxSchema.parse(wide.body))).toEqual({ 9: 'ready_to_merge' });
    expect((await inbox()).windowDays).toBe(30);
    await send('put', '/api/github/inbox/window', { windowDays: 7 }).expect(400);
  });

  it('refuses a malformed seen mark', async () => {
    await send('post', '/api/github/inbox/seen', { id: 'acme/widgets#1', headSha: 'xyz' }).expect(
      400,
    );
    await send('post', '/api/github/inbox/seen', { id: 'not an id', headSha: SHA }).expect(400);
  });
});

describe('inbox storage', () => {
  it('defaults the window to 14 days and keeps a saved choice without a profile row', async () => {
    await t.db.query('DELETE FROM profiles WHERE workspace_id = $1', [t.workspaceId]);
    expect(await inboxWindowDays(t.db, t.workspaceId)).toBe(14);
    await saveInboxWindowDays(t.db, t.workspaceId, 30);
    expect(await inboxWindowDays(t.db, t.workspaceId)).toBe(30);
    await expect(
      t.db.query('UPDATE profiles SET github_inbox_days = 7 WHERE workspace_id = $1', [
        t.workspaceId,
      ]),
    ).rejects.toThrow();
  });

  it('keeps one seen mark per pull request, replaced by the latest head', async () => {
    await markInboxSeen(t.db, t.workspaceId, 'acme/widgets#1', SHA);
    await markInboxSeen(t.db, t.workspaceId, 'acme/widgets#1', NEW_SHA);
    const marks = await inboxSeenMarks(t.db, t.workspaceId, ['acme/widgets#1', 'acme/widgets#2']);
    expect([...marks.keys()]).toEqual(['acme/widgets#1']);
    expect(marks.get('acme/widgets#1')?.headSha).toBe(NEW_SHA);
  });
});
