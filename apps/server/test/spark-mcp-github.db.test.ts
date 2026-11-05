import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { createProject } from '../src/projects/projects.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { callSparkTool } from '../src/spark-mcp/server.ts';
import { githubTools } from '../src/spark-mcp/tools/github-tools.ts';
import type { FakePull } from './fake-github.ts';
import { repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const SAVED_TOKEN = 'savedtok-0123456789ABCDEFabcdef';
const LEAKED_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`;

let t: TestDb;
let base: string;
let stub: GitHubStub;
let secrets: SecretStore;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-mcp-github-')));
  stub = await startGitHubStub();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await stub.close();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

async function linkProject(remote: 'github' | 'none' = 'github') {
  const { root } = await repoWithRemote(base, 'widgets', remote);
  return (await createProject(t.db, t.workspaceId, root)).project;
}

async function connectGitHub() {
  await secrets.set('github', SAVED_TOKEN);
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: 'octo-token',
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
}

function addPull(number: number, fields: Partial<FakePull> = {}) {
  stub.github.pulls.push({
    number,
    owner: 'acme',
    repo: 'widgets',
    title: `Change ${number}`,
    body: 'Why this change',
    head: `feature-${number}`,
    base: 'main',
    draft: false,
    state: 'open',
    html_url: `https://github.com/acme/widgets/pull/${number}`,
    openedBy: 'mona',
    via: 'token',
    ...fields,
  });
}

async function call(name: string, args: Record<string, unknown>) {
  const tool = githubTools.find((entry) => entry.name === name)!;
  const context = {
    deps: toolDeps(t, {
      secrets,
      github: {
        runCommand: async () => ({ code: 1, stdout: '', stderr: 'gh missing' }),
        locateGh: async () => null,
        apiUrl: stub.url,
      },
    }),
    scope: { workspaceId: t.workspaceId, conversationId: null, runId: null },
  };
  const result = await callSparkTool(tool, args, context);
  const first = result.content[0];
  const text = first?.type === 'text' ? first.text : '';
  return { text, isError: result.isError === true, json: <T>() => JSON.parse(text) as T };
}

describe('spark_pull_requests', () => {
  it('lists open pull requests with review state, CI and mergeability', async () => {
    const project = await linkProject();
    await connectGitHub();
    addPull(1, {
      checks: [
        { name: 'lint', status: 'completed', conclusion: 'success' },
        { name: 'test', status: 'completed', conclusion: 'failure' },
      ],
      reviews: [
        { user: { login: 'ana' }, state: 'APPROVED' },
        { user: { login: 'bo' }, state: 'CHANGES_REQUESTED' },
      ],
      mergeable: false,
      mergeable_state: 'dirty',
    });
    addPull(2, {
      checks: [{ name: 'test', status: 'completed', conclusion: 'success' }],
      reviews: [
        { user: { login: 'ana' }, state: 'CHANGES_REQUESTED' },
        { user: { login: 'ana' }, state: 'APPROVED' },
      ],
    });
    addPull(3, { checks: [{ name: 'test', status: 'in_progress', conclusion: null }] });
    addPull(4, { state: 'closed' });

    const result = await call('spark_pull_requests', { project: project.name });

    expect(result.isError).toBe(false);
    expect(result.text).not.toContain(SAVED_TOKEN);
    const body = result.json<{ repo: string; pulls: Record<string, unknown>[] }>();
    expect(body.repo).toBe('acme/widgets');
    expect(body.pulls).toEqual([
      expect.objectContaining({ number: 3, reviewState: 'review', ci: { state: 'pending' } }),
      expect.objectContaining({
        number: 2,
        reviewState: 'approved',
        ci: { state: 'passing' },
        mergeable: true,
        mergeState: 'clean',
      }),
      expect.objectContaining({
        number: 1,
        title: 'Change 1',
        author: 'mona',
        head: 'feature-1',
        base: 'main',
        draft: false,
        reviewState: 'changes_requested',
        ci: { state: 'failing', failing: ['test'] },
        mergeable: false,
        mergeState: 'dirty',
        url: 'https://github.com/acme/widgets/pull/1',
      }),
    ]);
  });

  it('honours state and limit', async () => {
    const project = await linkProject();
    await connectGitHub();
    addPull(1);
    addPull(2, { state: 'closed' });
    addPull(3, { state: 'closed' });

    const body = (
      await call('spark_pull_requests', { project: project.name, state: 'closed', limit: 1 })
    ).json<{ pulls: { number: number; ci: unknown }[] }>();

    expect(body.pulls).toEqual([expect.objectContaining({ number: 3, ci: { state: 'none' } })]);
  });

  it('explains a project without a GitHub remote', async () => {
    const project = await linkProject('none');
    await connectGitHub();

    const result = await call('spark_pull_requests', { project: project.name });

    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain('has no GitHub remote');
  });

  it('asks to connect GitHub when neither gh nor a token is available', async () => {
    const project = await linkProject();

    const result = await call('spark_pull_requests', { project: project.name });

    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain('Connect GitHub in Settings');
  });
});

describe('spark_pr', () => {
  it('reads one pull request with paged files and comments, redacted and clipped', async () => {
    const project = await linkProject();
    await connectGitHub();
    addPull(7, {
      body: 'x'.repeat(500),
      additions: 12,
      deletions: 3,
      files: ['a.ts', 'b.ts', 'c.ts'].map((filename) => ({
        filename,
        status: 'modified',
        additions: 4,
        deletions: 1,
      })),
      checks: [{ name: 'test', status: 'completed', conclusion: 'success' }],
      reviews: [{ user: { login: 'ana' }, state: 'COMMENTED' }],
      reviewComments: [
        { path: 'a.ts', line: 3, user: { login: 'ana' }, body: 'Rename this' },
        { path: 'b.ts', line: null, user: { login: 'ana' }, body: 'And this' },
      ],
      issueComments: [
        { user: { login: 'bo' }, body: `oops, token ${LEAKED_TOKEN}` },
        { user: { login: 'bo' }, body: 'Looks good' },
        { user: { login: 'cy' }, body: 'Ship it' },
      ],
    });

    const first = await call('spark_pr', {
      project: project.name,
      number: 7,
      limit: 2,
      maxChars: 200,
    });
    const second = await call('spark_pr', {
      project: project.name,
      number: 7,
      offset: 2,
      limit: 2,
    });

    expect(first.isError).toBe(false);
    expect(first.text).not.toContain(LEAKED_TOKEN);
    expect(first.text).not.toContain(SAVED_TOKEN);
    const body = first.json<Record<string, unknown> & { body: string }>();
    expect(body.body).toHaveLength(200);
    expect(body).toMatchObject({
      number: 7,
      state: 'open',
      author: 'mona',
      head: 'feature-7',
      base: 'main',
      additions: 12,
      deletions: 3,
      mergeable: true,
      checks: [{ name: 'test', status: 'completed', conclusion: 'success' }],
      reviews: [{ user: 'ana', state: 'COMMENTED' }],
      files: {
        total: 3,
        offset: 0,
        nextOffset: 2,
        items: [
          { filename: 'a.ts', status: 'modified', additions: 4, deletions: 1 },
          expect.objectContaining({ filename: 'b.ts' }),
        ],
      },
      reviewComments: {
        total: 2,
        items: [
          { path: 'a.ts', line: 3, user: 'ana', body: 'Rename this' },
          { path: 'b.ts', line: null, user: 'ana', body: 'And this' },
        ],
      },
      issueComments: { total: 3, nextOffset: 2 },
    });
    expect(first.text).toContain('[redacted:github_token]');
    expect(second.json()).toMatchObject({
      files: { total: 3, offset: 2, items: [expect.objectContaining({ filename: 'c.ts' })] },
      reviewComments: { total: 2, offset: 2, items: [] },
      issueComments: { items: [{ user: 'cy', body: 'Ship it' }] },
    });
  });

  it('pages across GitHub pages of 100', async () => {
    const project = await linkProject();
    await connectGitHub();
    addPull(8, {
      files: Array.from({ length: 150 }, (_, index) => ({
        filename: `f${index}.ts`,
        status: 'added',
        additions: 1,
        deletions: 0,
      })),
    });

    const body = (
      await call('spark_pr', { project: project.name, number: 8, offset: 95, limit: 10 })
    ).json<{ files: { items: { filename: string }[]; nextOffset: number } }>();

    expect(body.files.items.map((file) => file.filename)).toEqual(
      Array.from({ length: 10 }, (_, index) => `f${95 + index}.ts`),
    );
    expect(body.files.nextOffset).toBe(105);
  });

  it('explains a missing pull request', async () => {
    const project = await linkProject();
    await connectGitHub();

    const result = await call('spark_pr', { project: project.name, number: 99 });

    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain('no pull request #99 in acme/widgets');
  });
});
