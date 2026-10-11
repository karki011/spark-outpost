import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import type { PublishScope } from '../src/ship/agent-push.ts';
import { sparkAvailability } from '../src/spark-mcp/availability.ts';
import { callSparkTool } from '../src/spark-mcp/server.ts';
import { NOT_AUTHORIZED, PUSH_ONLY, publishTools } from '../src/spark-mcp/tools/publish-tools.ts';
import { linkedConversation } from './approval-support.ts';
import { FAKE_GH, git, repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const BRANCH = 'spark/notes-1a2b3c4d';
const SAVED_TOKEN = 'savedtok-0123456789ABCDEFabcdef';

let t: TestDb;
let base: string;
let root: string;
let bare: string;
let stub: GitHubStub;
let secrets: SecretStore;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-mcp-publish-')));
  stub = await startGitHubStub();
  secrets = memorySecretStore();
  ({ root, bare } = await repoWithRemote(base, 'widgets'));
  git(root, 'checkout', '-qb', BRANCH);
  git(root, 'commit', '-q', '--allow-empty', '-m', 'Tidy the notes');
  const linked = await linkedConversation(t, root);
  conversationId = linked.conversationId;
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId,
    projectId: linked.projectId,
    repoRoot: root,
    path: root,
    branch: BRANCH,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
});

afterEach(async () => {
  await stub.close();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

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

const publish = (): PublishScope => ({
  basis: 'requested',
  task: { branch: BRANCH, protectedBranches: ['main', 'master'] },
  root,
  opensPull: true,
  pushOnly: false,
});

const NO_GH = {
  runCommand: async () => ({ code: 1, stdout: '', stderr: 'gh missing' }),
  locateGh: async () => null,
};

function deps(github: Record<string, unknown> = NO_GH) {
  return toolDeps(t, { secrets, github: { ...NO_GH, ...github, apiUrl: stub.url } });
}

async function call(
  name: string,
  args: Record<string, unknown>,
  authorized: boolean | PublishScope = true,
) {
  const tool = publishTools.find((entry) => entry.name === name)!;
  const scope = {
    workspaceId: t.workspaceId,
    conversationId,
    runId: null,
    ...(authorized ? { publish: authorized === true ? publish() : authorized } : {}),
  };
  const result = await callSparkTool(tool, args, { deps: deps(), scope });
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  return { text, isError: result.isError === true };
}

const remoteBranches = () => git(bare, 'branch', '--list');

describe('the publish tools an agent is given', { timeout: 60_000 }, () => {
  it('refuse to push or open a pull request when publishing is not authorized', async () => {
    const pushed = await call('spark_push', {}, false);
    expect(pushed).toEqual({ text: NOT_AUTHORIZED, isError: true });
    const opened = await call('spark_pull_request', { title: 'Tidy the notes' }, false);
    expect(opened).toEqual({ text: NOT_AUTHORIZED, isError: true });
    expect(remoteBranches()).not.toContain(BRANCH);
    expect(stub.github.pulls).toEqual([]);
  });

  it('push the branch, then open its pull request through the GitHub connection', async () => {
    await connectGitHub();
    const early = await call('spark_pull_request', { title: 'Tidy the notes' });
    expect(early.isError).toBe(true);
    expect(early.text).toContain('Push it first with spark_push');
    const pushed = JSON.parse((await call('spark_push', {})).text) as Record<string, unknown>;
    expect(pushed).toMatchObject({ pushed: true, branch: BRANCH, repo: 'acme/widgets' });
    expect(remoteBranches()).toContain(BRANCH);
    const opened = JSON.parse(
      (await call('spark_pull_request', { title: 'Tidy the notes', body: 'Why', draft: true }))
        .text,
    ) as Record<string, unknown>;
    expect(opened).toMatchObject({
      url: 'https://github.com/acme/widgets/pull/1',
      number: 1,
      created: true,
      draft: true,
    });
    expect(stub.github.pulls[0]).toMatchObject({ head: BRANCH, base: 'main', draft: true });
  });

  it('update the pull request that already exists instead of opening a second one', async () => {
    await connectGitHub();
    await call('spark_push', {});
    await call('spark_pull_request', { title: 'Tidy the notes' });
    const again = JSON.parse(
      (await call('spark_pull_request', { title: 'Tidy the notes, with tests' })).text,
    ) as Record<string, unknown>;
    expect(again).toMatchObject({ number: 1, created: false });
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]!.title).toBe('Tidy the notes, with tests');
  });

  it("open a stacked chat's pull request against the branch it is built on", async () => {
    await connectGitHub();
    const parent = 'spark/orders-endpoint-9f8e7d6c';
    git(root, 'branch', parent, 'main');
    git(root, 'push', '-q', 'origin', parent);
    const stacked: PublishScope = {
      ...publish(),
      task: {
        ...publish().task,
        stackBase: { branch: parent, owner: '@api', onRemote: true },
        pullBase: parent,
      },
    };
    await call('spark_push', {}, stacked);
    await call('spark_pull_request', { title: 'Orders page' }, stacked);
    expect(stub.github.pulls[0]).toMatchObject({ head: BRANCH, base: parent });
  });

  it('push and open no pull request when the message asked for the push alone', async () => {
    await connectGitHub();
    const pushOnly: PublishScope = { ...publish(), opensPull: false, pushOnly: true };
    const pushed = JSON.parse((await call('spark_push', {}, pushOnly)).text) as { next: string };
    expect(pushed).toMatchObject({ pushed: true, branch: BRANCH });
    expect(pushed.next).toContain('Do not open a pull request');
    const opened = await call('spark_pull_request', { title: 'Tidy the notes' }, pushOnly);
    expect(opened).toEqual({ text: PUSH_ONLY, isError: true });
    expect(stub.github.pulls).toEqual([]);
  });

  it('say plainly when GitHub is not connected', async () => {
    await call('spark_push', {});
    const opened = await call('spark_pull_request', { title: 'Tidy the notes' });
    expect(opened.isError).toBe(true);
    expect(opened.text).toContain('GitHub is not connected for github.com');
  });
});

describe('when the pull request tool is offered', () => {
  const scope = () => ({ workspaceId: t.workspaceId, conversationId, runId: null });

  it('is offered with a saved GitHub connection and no signed-in gh', async () => {
    await connectGitHub();
    const available = await sparkAvailability(deps(), scope());
    expect(available).toMatchObject({ publish: true, pull_request_create: true });
  });

  it('is not offered when gh is signed in, or when nothing is connected', async () => {
    expect((await sparkAvailability(deps(), scope())).pull_request_create).toBe(false);
    await connectGitHub();
    const withGh = deps({
      locateGh: async () => FAKE_GH,
      runCommand: async () => ({
        code: 0,
        stdout: 'Logged in to github.com account octo-cli (keyring)',
        stderr: '',
      }),
    });
    const available = await sparkAvailability(withGh, scope());
    expect(available).toMatchObject({ publish: true, pull_request_create: false });
  });
});
