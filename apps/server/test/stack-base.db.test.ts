import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stackBaseOf, stackParentOf } from '../src/outposts/stack-base.ts';
import { leaveOutpost } from '../src/outposts/post-service.ts';
import { ownedWorktree, stackedPair, watchedPull, type StackedPair } from './stack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const API_BRANCH = 'spark/orders-endpoint-1a2b3c4d';

let t: TestDb;
let scratch: string;
let root: string;
let pair: StackedPair;

beforeEach(async () => {
  t = await createTestDb();
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-stack-base-')));
  root = join(scratch, 'shop');
  await mkdir(root);
  await mkdir(join(scratch, 'site'));
  pair = await stackedPair(t, root);
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

const apiPlace = () => ({ conversationId: pair.api, projectId: pair.projectId, root });

describe('the branch a sub-task chat is stacked on', () => {
  it("is the parent chat's own branch in the same project", async () => {
    await ownedWorktree(t, apiPlace(), API_BRANCH, 'main');
    expect(await stackBaseOf(t.db, pair.web)).toEqual({
      parentChatId: pair.api,
      owner: '@api',
      branch: API_BRANCH,
    });
  });

  it('is nothing for a chat that depends on no other', async () => {
    await ownedWorktree(t, apiPlace(), API_BRANCH, 'main');
    expect(await stackParentOf(t.db, pair.api)).toBeNull();
    expect(await stackBaseOf(t.db, pair.api)).toBeNull();
  });

  it('is nothing while the parent chat has no branch, and names the parent', async () => {
    expect(await stackBaseOf(t.db, pair.web)).toBeNull();
    expect(await stackParentOf(t.db, pair.web)).toEqual({
      parentChatId: pair.api,
      owner: '@api',
      branch: null,
    });
  });

  it('is nothing when the parent works on a branch it does not own', async () => {
    const id = await ownedWorktree(t, apiPlace(), 'feature/login', 'feature/login');
    await t.db.query('UPDATE chat_worktrees SET owns_branch = false WHERE id = $1', [id]);
    expect(await stackBaseOf(t.db, pair.web)).toBeNull();
  });

  it('is nothing when the parent chat works in another project', async () => {
    const other = await stackedPair(t, root, join(scratch, 'site'));
    await ownedWorktree(
      t,
      { conversationId: other.api, projectId: other.projectId, root },
      API_BRANCH,
      'main',
    );
    expect(await stackParentOf(t.db, other.web)).toBeNull();
  });

  it("is nothing once the parent's pull request is merged or closed", async () => {
    await ownedWorktree(t, apiPlace(), API_BRANCH, 'main');
    await watchedPull(t, pair.api, API_BRANCH, 'open');
    expect((await stackBaseOf(t.db, pair.web))?.branch).toBe(API_BRANCH);
    for (const state of ['merged', 'closed']) {
      await t.db.query('UPDATE pr_watches SET pr_state = $1', [state]);
      expect(await stackBaseOf(t.db, pair.web)).toBeNull();
    }
  });

  it('is nothing after the parent chat leaves the story', async () => {
    await ownedWorktree(t, apiPlace(), API_BRANCH, 'main');
    await leaveOutpost(
      { db: t.db, workspaceId: t.workspaceId },
      { outpostId: pair.outpostId, conversationId: pair.api },
    );
    expect(await stackParentOf(t.db, pair.web)).toBeNull();
  });
});
