import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubInboxSchema, githubPullDetailsSchema } from '@spark-outpost/contracts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { TOKEN_LOGIN, type FakePull } from './fake-github.ts';
import { repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let github: GitHubStub;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;
let base: string;

beforeEach(async () => {
  t = await createTestDb();
  github = await startGitHubStub();
  secrets = memorySecretStore();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-github-details-')));
  app = createTestApp(t, { secrets, fetch, githubApiUrl: github.url });
  await secrets.set('github', 'ghp_test_token');
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: TOKEN_LOGIN,
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
});

afterEach(async () => {
  await github.close();
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

const post = (url: string, body: object) =>
  request(app).post(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

const details = (id: string) =>
  request(app).get('/api/github/inbox/details').query({ id }).set(LOCAL_HEADERS);

async function linkWidgets(): Promise<string> {
  const repo = await repoWithRemote(base, 'widgets');
  const created = await post('/api/projects', { rootPath: repo.root }).expect(201);
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
    sha: 'a'.repeat(40),
    updated_at: new Date().toISOString(),
    created_at: '2026-11-10T09:00:00Z',
    ...fields,
  });
}

async function loadInbox() {
  const answer = await request(app).get('/api/github/inbox').set(LOCAL_HEADERS).expect(200);
  return githubInboxSchema.parse(answer.body);
}

describe('pull request details on the GitHub page', () => {
  it('lists branches, labels, dates and a description preview with each pull request', async () => {
    await linkWidgets();
    pull(4, { body: 'Fixes the **widget** sizes.', labels: ['bug'], base: 'release' });
    const shown = await loadInbox();
    expect(shown.items[0]).toMatchObject({
      headRef: 'change-4',
      baseRef: 'release',
      createdAt: '2026-11-10T09:00:00Z',
      labels: [{ name: 'bug', color: '0e8a16' }],
      bodyPreview: 'Fixes the **widget** sizes.',
    });
  });

  it('reads the description and changed files of a pull request on the page', async () => {
    await linkWidgets();
    pull(4, {
      body: '## Summary\n\nFixes sizes.',
      files: [
        { filename: 'src/widget.ts', status: 'modified', additions: 12, deletions: 3 },
        { filename: 'src/size.ts', status: 'added', additions: 30, deletions: 0 },
      ],
    });
    await loadInbox();
    const answer = await details('acme/widgets#4').expect(200);
    expect(githubPullDetailsSchema.parse(answer.body)).toEqual({
      id: 'acme/widgets#4',
      body: '## Summary\n\nFixes sizes.',
      bodyCut: false,
      files: [
        { path: 'src/widget.ts', status: 'modified', additions: 12, deletions: 3 },
        { path: 'src/size.ts', status: 'added', additions: 30, deletions: 0 },
      ],
      filesTotal: 2,
    });
  });

  it('reads a review request from a repository that is not a linked project', async () => {
    await linkWidgets();
    pull(10, {
      owner: 'other',
      repo: 'elsewhere',
      openedBy: 'alice',
      requestedReviewers: [TOKEN_LOGIN],
      body: 'Please look.',
      html_url: 'https://github.com/other/elsewhere/pull/10',
    });
    await loadInbox();
    const answer = await details('other/elsewhere#10').expect(200);
    expect(answer.body).toMatchObject({ body: 'Please look.', filesTotal: 0 });
  });

  it('cuts a very long description and says so', async () => {
    await linkWidgets();
    pull(4, { body: 'x'.repeat(70_000) });
    await loadInbox();
    const answer = await details('acme/widgets#4').expect(200);
    expect(answer.body.body).toHaveLength(60_000);
    expect(answer.body.bodyCut).toBe(true);
  });

  it('answers only for pull requests on the page', async () => {
    await linkWidgets();
    pull(4);
    await loadInbox();
    const before = github.github.requests.length;
    await details('acme/widgets#99').expect(404);
    await details('someone/else#1').expect(404);
    await details('not a pull request').expect(400);
    expect(github.github.requests.length).toBe(before);
  });

  it('stays on the Mac only', () => {
    expect(ROUTE_RULES.get('GET /api/github/inbox/details')).toBe('never');
  });
});

describe('pull requests you already reviewed', () => {
  it('lists those you approved and those you only reviewed from any repository', async () => {
    await linkWidgets();
    const others = { owner: 'other', repo: 'elsewhere', openedBy: 'alice' };
    pull(20, { ...others, reviews: [{ user: { login: TOKEN_LOGIN }, state: 'APPROVED' }] });
    pull(21, { ...others, reviews: [{ user: { login: TOKEN_LOGIN }, state: 'COMMENTED' }] });
    pull(22, {
      ...others,
      requestedReviewers: [TOKEN_LOGIN],
      reviews: [{ user: { login: TOKEN_LOGIN }, state: 'APPROVED' }],
    });
    pull(23, { ...others, reviews: [{ user: { login: 'bob' }, state: 'APPROVED' }] });
    pull(24, { reviews: [{ user: { login: TOKEN_LOGIN }, state: 'COMMENTED' }] });
    const shown = await loadInbox();
    expect(Object.fromEntries(shown.items.map((item) => [item.number, item.group]))).toEqual({
      20: 'approved',
      21: 'reviewed',
      22: 'review_requested',
      24: 'waiting',
    });
    expect(shown.items.find((item) => item.number === 20)).toMatchObject({
      mine: false,
      unseen: false,
      approvedBy: [TOKEN_LOGIN],
    });
  });
});

describe('starting a chat for a pull request', () => {
  it('creates a chat linked to the project with the pull request as its title', async () => {
    const projectId = await linkWidgets();
    const id = randomUUID();
    const created = await post('/api/conversations', {
      id,
      sessionType: 'chat',
      projectIds: [projectId],
      title: 'PR #4: Change 4',
    }).expect(201);
    expect(created.body).toMatchObject({ id, title: 'PR #4: Change 4' });
    const { rows } = await t.db.query<{ project_id: string }>(
      'SELECT project_id FROM conversation_projects WHERE conversation_id = $1',
      [id],
    );
    expect(rows).toEqual([{ project_id: projectId }]);
  });
});
