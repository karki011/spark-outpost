import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { saveDraft } from '../src/persistence/outpost-drafts.ts';
import { insertPosts } from '../src/persistence/outpost-posts.ts';
import {
  insertTasks,
  removeTask,
  storiesOf,
  storyTaskOf,
} from '../src/persistence/outpost-stories.ts';
import { createOutpost } from '../src/persistence/outposts.ts';
import type { NewStoryTask } from '../src/outposts/ports.ts';
import { leaveOutpost } from '../src/outposts/post-service.ts';
import { createProject } from '../src/projects/projects.ts';
import { newChat } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let projectId: string;
let outpostId: string;
let draftId: string;
let lead: string;
let api: string;
let web: string;
let apiPost: string;
let webPost: string;

async function projectChat(): Promise<string> {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id, { projectIds: [projectId] });
  return id;
}

async function opening(to: string, handle: string, afterPostId: string | null): Promise<string> {
  const [post] = await insertPosts(t.db, [
    {
      id: randomUUID(),
      outpostId,
      kind: 'request',
      body: `Build ${handle}.`,
      fromUser: false,
      fromConversationId: lead,
      fromHandle: 'lead',
      toHandle: handle,
      toConversationId: to,
      opening: true,
      userStarted: true,
      afterPostId,
    },
  ]);
  return post!.id;
}

function task(conversationId: string, position: number, extra: Partial<NewStoryTask> = {}) {
  return {
    conversationId,
    outpostId,
    draftId,
    leadConversationId: lead,
    title: `Task ${position}`,
    position,
    dependsOnConversationId: null,
    openingPostId: null,
    ...extra,
  };
}

async function worktree(conversationId: string, branch: string, baseBranch: string) {
  await t.db.query(
    `INSERT INTO chat_worktrees (id, conversation_id, project_id, repo_root, path, branch,
       base_branch, base_commit, owns_branch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'abc123', true)`,
    [randomUUID(), conversationId, projectId, root, join(root, branch), branch, baseBranch],
  );
}

async function pull(conversationId: string, number: number, branch: string, base: string) {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
       branch, base, head_sha)
     VALUES ($1, $2, $3, 'github.com', 'acme', 'shop', $4, $5, $6, $7, 'sha1')`,
    [
      id,
      t.workspaceId,
      conversationId,
      number,
      `https://github.com/acme/shop/pull/${number}`,
      branch,
      base,
    ],
  );
  return id;
}

beforeEach(async () => {
  t = await createTestDb();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-outpost-stories-')));
  projectId = (await createProject(t.db, t.workspaceId, root)).project.id;
  lead = await newChat(t);
  [api, web] = [await projectChat(), await projectChat()];
  outpostId = randomUUID();
  await createOutpost(t.db, {
    id: outpostId,
    workspaceId: t.workspaceId,
    name: 'Orders launch',
    members: [
      { conversationId: lead, handle: 'lead' },
      { conversationId: api, handle: 'api' },
      { conversationId: web, handle: 'web' },
    ],
  });
  draftId = randomUUID();
  await saveDraft(t.db, {
    id: draftId,
    workspaceId: t.workspaceId,
    conversationId: lead,
    runId: null,
    outpostId,
    body: {
      title: 'Checkout',
      chats: [{ handle: 'api', title: 'Orders endpoint', projectId, task: 'Add the endpoint.' }],
    },
  });
  apiPost = await opening(api, 'api', null);
  webPost = await opening(web, 'web', apiPost);
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

function story() {
  return [
    task(api, 0, { openingPostId: apiPost }),
    task(web, 1, { openingPostId: webPost, dependsOnConversationId: api }),
  ];
}

describe('story tasks', () => {
  it('stores the tasks of a story and reads each with its handle, lead, project and opening post', async () => {
    const stored = await insertTasks(t.db, story());

    expect(stored.map((row) => [row.conversationId, row.dependsOnConversationId])).toEqual([
      [api, null],
      [web, api],
    ]);
    const rows = await storiesOf(t.db, outpostId);
    expect(rows.map((row) => row.handle)).toEqual(['api', 'web']);
    expect(rows[1]).toMatchObject({
      task: {
        conversationId: web,
        draftId,
        leadConversationId: lead,
        dependsOnConversationId: api,
        openingPostId: webPost,
      },
      storyTitle: 'Checkout',
      leadHandle: 'lead',
      projectId,
      repoRoot: root,
      branch: null,
      baseBranch: null,
      ownsBranch: false,
      pull: null,
    });
    expect(rows[1]?.opening?.post.id).toBe(webPost);
    expect(rows[1]?.opening?.facts).toMatchObject({ waitingOn: 'api', sent: false });
    expect(await storyTaskOf(t.db, web)).toEqual(rows[1]);
    expect(await storyTaskOf(t.db, lead)).toBeNull();
    expect(await storiesOf(t.db, randomUUID())).toEqual([]);
  });

  it('reads the branch from the live worktree and the pull request on that branch', async () => {
    await insertTasks(t.db, story());
    await worktree(api, 'spark/api', 'main');
    await worktree(web, 'spark/web', 'spark/api');
    await pull(web, 7, 'spark/old', 'main');
    await pull(web, 124, 'spark/web', 'spark/api');
    await pull(api, 123, 'spark/api', 'main');

    const [first, second] = await storiesOf(t.db, outpostId);

    expect(first).toMatchObject({ branch: 'spark/api', baseBranch: 'main', ownsBranch: true });
    expect(first?.pull).toMatchObject({ number: 123, base: 'main', state: 'open', draft: false });
    expect(second).toMatchObject({ branch: 'spark/web', baseBranch: 'spark/api' });
    expect(second?.pull).toEqual({
      number: 124,
      url: 'https://github.com/acme/shop/pull/124',
      state: 'open',
      draft: false,
      base: 'spark/api',
      headSha: 'sha1',
    });
  });

  it('ignores a removed worktree', async () => {
    await insertTasks(t.db, story());
    await worktree(api, 'spark/api', 'main');
    await t.db.query('UPDATE chat_worktrees SET removed_at = now() WHERE conversation_id = $1', [
      api,
    ]);

    expect((await storiesOf(t.db, outpostId))[0]).toMatchObject({ branch: null, repoRoot: root });
  });

  it('keeps one row per chat when the same tasks are stored again, and fills a missing opening post', async () => {
    await insertTasks(t.db, [task(api, 0), task(web, 1, { dependsOnConversationId: api })]);

    const again = await insertTasks(t.db, [
      task(api, 5, { openingPostId: apiPost, title: 'Changed' }),
      task(web, 6, { openingPostId: webPost }),
    ]);

    expect(again.map((row) => [row.title, row.position, row.openingPostId])).toEqual([
      ['Task 0', 0, apiPost],
      ['Task 1', 1, webPost],
    ]);
    expect(again[1]?.dependsOnConversationId).toBe(api);
    const other = await opening(api, 'api', null);
    const third = await insertTasks(t.db, [task(api, 0, { openingPostId: other })]);
    expect(third[0]?.openingPostId).toBe(apiPost);
  });

  it('leaves a chat in the story it already belongs to when another story names it', async () => {
    await insertTasks(t.db, [task(api, 0)]);
    const laterDraft = randomUUID();
    await saveDraft(t.db, {
      id: laterDraft,
      workspaceId: t.workspaceId,
      conversationId: lead,
      runId: null,
      outpostId,
      body: {
        title: 'Refunds',
        chats: [{ handle: 'api', title: 'Refund endpoint', projectId, task: 'Add refunds.' }],
      },
    });

    const stored = await insertTasks(t.db, [
      task(api, 0, { draftId: laterDraft, openingPostId: apiPost }),
    ]);

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ draftId, openingPostId: null });
  });

  it('drops the task of a chat that leaves and frees its dependents, so the chat can join a new story', async () => {
    await insertTasks(t.db, story());

    expect(
      await leaveOutpost(
        { db: t.db, workspaceId: t.workspaceId },
        { outpostId, conversationId: api },
      ),
    ).toBe(true);

    const rows = await storiesOf(t.db, outpostId);
    expect(rows.map((row) => [row.handle, row.task.dependsOnConversationId])).toEqual([
      ['web', null],
    ]);
    expect(rows[0]?.opening?.facts).toMatchObject({ waitingOn: 'api' });
    expect(await removeTask(t.db, api)).toBe(false);
    expect(await insertTasks(t.db, [task(api, 2)])).toHaveLength(1);
  });

  it('keeps the story with its title when the lead chat is deleted', async () => {
    await insertTasks(t.db, story());

    await t.db.query('DELETE FROM conversations WHERE id = $1', [lead]);

    const rows = await storiesOf(t.db, outpostId);
    expect(rows.map((row) => row.handle)).toEqual(['api', 'web']);
    for (const row of rows) {
      expect(row).toMatchObject({ storyTitle: 'Checkout', leadHandle: null });
      expect(row.task).toMatchObject({ draftId, leadConversationId: null });
    }
  });

  it('drops the task of a deleted sub-task chat and leaves its dependent waiting for a deleted chat', async () => {
    await insertTasks(t.db, story());

    await t.db.query('DELETE FROM conversations WHERE id = $1', [api]);

    const rows = await storiesOf(t.db, outpostId);
    expect(rows.map((row) => [row.handle, row.task.dependsOnConversationId])).toEqual([
      ['web', null],
    ]);
    expect(rows[0]?.opening?.facts).toMatchObject({ waitingOn: null, waitingOnDeleted: true });
  });

  it('writes the tasks of a story together or not at all', async () => {
    const tasks = [task(api, 0), task(web, 1, { dependsOnConversationId: web })];

    await expect(insertTasks(t.db, tasks)).rejects.toThrow();

    expect(await storiesOf(t.db, outpostId)).toEqual([]);
  });
});
