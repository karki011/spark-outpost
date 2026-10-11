import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stackGit } from '../src/outposts/stack-git.ts';
import { publishStackOf } from '../src/outposts/stack-publish.ts';
import { chatWorktreeAt, type ChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { removeTask } from '../src/persistence/outpost-stories.ts';
import { taskBranch } from '../src/workflow/publish-context.ts';
import { git, repoWithRemote, type TestRepo } from './ship-support.ts';
import { ownedWorktree, stackedPair, watchedPull, type StackedPair } from './stack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const API = 'spark/orders-endpoint-1a2b3c4d';
const WEB = 'spark/orders-page-5e6f7a8b';

let t: TestDb;
let scratch: string;
let repo: TestRepo;
let pair: StackedPair;
let webPath: string;

beforeEach(async () => {
  t = await createTestDb();
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-stack-publish-')));
  repo = await repoWithRemote(scratch, 'shop');
  pair = await stackedPair(t, repo.root);
  git(repo.root, 'branch', API);
  git(repo.root, 'branch', WEB, API);
  webPath = join(scratch, 'web-copy');
  const place = { projectId: pair.projectId, root: repo.root };
  await ownedWorktree(t, { ...place, conversationId: pair.api }, API, 'main');
  await ownedWorktree(t, { ...place, conversationId: pair.web, path: webPath }, WEB, API);
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

async function web(): Promise<ChatWorktree> {
  return (await chatWorktreeAt(t.db, webPath))!;
}

const stack = async () => publishStackOf(t.db, stackGit, await web());

describe('what a stacked chat publishes against', { timeout: 30_000 }, () => {
  it("is the parent chat's branch while the stack is live, and knows it is not pushed", async () => {
    expect(await stack()).toEqual({
      pullBase: API,
      stackBase: { branch: API, owner: '@api', onRemote: false },
    });
    git(repo.root, 'push', '-q', 'origin', API);
    expect((await stack())?.stackBase).toEqual({ branch: API, owner: '@api', onRemote: true });
  });

  it("stays the parent branch while the parent's pull request is open", async () => {
    await watchedPull(t, pair.api, API, 'open');
    expect((await stack())?.pullBase).toBe(API);
  });

  it("is the default branch once the parent's pull request is merged or closed", async () => {
    await watchedPull(t, pair.api, API, 'open');
    for (const state of ['merged', 'closed']) {
      await t.db.query('UPDATE pr_watches SET pr_state = $1', [state]);
      expect(await stack()).toEqual({ pullBase: 'main', stackBase: null });
    }
  });

  it('is the default branch once the parent chat is deleted', async () => {
    await deleteConversation(t.db, t.workspaceId, pair.api);
    expect(await stack()).toEqual({ pullBase: 'main', stackBase: null });
  });

  it('is the default branch once the parent branch is gone from the repository', async () => {
    git(repo.root, 'branch', '-qD', API);
    expect(await stack()).toEqual({ pullBase: 'main', stackBase: null });
  });

  it('says nothing for the parent chat, or for a chat that is in no story', async () => {
    const api = (
      await t.db.query<{ path: string }>(
        'SELECT path FROM chat_worktrees WHERE conversation_id = $1',
        [pair.api],
      )
    ).rows[0]!;
    expect(
      await publishStackOf(t.db, stackGit, (await chatWorktreeAt(t.db, api.path))!),
    ).toBeNull();
    await removeTask(t.db, pair.web);
    expect(await stack()).toBeNull();
  });
});

describe('the task branch the publish rules read for a stacked chat', { timeout: 30_000 }, () => {
  it('carries the stack base, and protects the parent branch from a push', async () => {
    const task = await taskBranch(t.db, webPath);
    expect(task).toMatchObject({
      branch: WEB,
      pullBase: API,
      stackBase: { branch: API, owner: '@api', onRemote: false },
    });
    expect(task!.protectedBranches).toContain(API);
  });

  it('is unchanged for a chat that is not stacked', async () => {
    await removeTask(t.db, pair.web);
    const task = await taskBranch(t.db, webPath);
    expect(task).toEqual({ branch: WEB, protectedBranches: ['main', 'master', API], pull: null });
  });
});
