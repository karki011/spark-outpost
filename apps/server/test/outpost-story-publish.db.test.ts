import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { queueWrapUps } from '../src/outposts/story-wrap-ups.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import {
  answerCache,
  requestAnswer,
  type AnswerCache,
} from '../src/persistence/outpost-answers.ts';
import { markStarted, saveDraft } from '../src/persistence/outpost-drafts.ts';
import { getPost, insertPosts, listPosts } from '../src/persistence/outpost-posts.ts';
import { insertTasks } from '../src/persistence/outpost-stories.ts';
import { createOutpost } from '../src/persistence/outposts.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { acceptRequestRow, postRunId } from './outpost-fixtures.ts';
import { newChat } from './outpost-store-support.ts';
import { chatOnItsBranch, CHAT_BRANCH, shipAccessTo } from './publish-step-support.ts';
import { git, startGitHubStub, type GitHubStub, type TestRepo } from './ship-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';
import { driveToEnd } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const WEB_BRANCH = 'spark/orders-page-5e6f7a8b';
const TASK = 'Build this part. #build';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let worker: Worker;
let repo: TestRepo;
let outpostId: string;
let lead: string;
let api: string;
let web: string;
let posts: { api: string; web: string };

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-story-publish-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

async function opening(to: string, handle: string, afterPostId: string | null): Promise<string> {
  const [post] = await insertPosts(t.db, [
    {
      id: randomUUID(),
      outpostId,
      kind: 'request',
      body: TASK,
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

async function startStory(): Promise<void> {
  const draftId = randomUUID();
  const projectId = randomUUID();
  await saveDraft(t.db, {
    id: draftId,
    workspaceId: t.workspaceId,
    conversationId: lead,
    runId: null,
    outpostId: null,
    body: { title: 'Checkout', chats: [{ handle: 'api', title: 'Orders', projectId, task: TASK }] },
  });
  await markStarted(t.db, draftId, outpostId);
  const apiPost = await opening(api, 'api', null);
  posts = { api: apiPost, web: await opening(web, 'web', apiPost) };
  const common = { outpostId, draftId, leadConversationId: lead };
  await insertTasks(t.db, [
    {
      ...common,
      conversationId: api,
      title: 'Orders endpoint',
      position: 0,
      dependsOnConversationId: null,
      openingPostId: posts.api,
    },
    {
      ...common,
      conversationId: web,
      title: 'Orders page',
      position: 1,
      dependsOnConversationId: api,
      openingPostId: posts.web,
    },
  ]);
}

async function stackWebOnApi(projectId: string): Promise<void> {
  const webPath = path.join(base, `web-${randomUUID()}`);
  git(repo.root, 'worktree', 'add', '-q', '-b', WEB_BRANCH, webPath, CHAT_BRANCH);
  await t.db.query(
    'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
    [web, projectId],
  );
  await pinChatLevel(t.db, web, 'full-auto');
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId: web,
    projectId,
    repoRoot: repo.root,
    path: webPath,
    branch: WEB_BRANCH,
    baseBranch: CHAT_BRANCH,
    baseCommit: git(repo.root, 'rev-parse', CHAT_BRANCH),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
}

async function answerRequest(chat: string, postId: string): Promise<void> {
  await acceptRequestRow(t.db, postId);
  const target = async () => ({
    provider: 'claude',
    permission: 'do',
    agentMode: 'auto',
    level: 'full-auto' as const,
  });
  expect(await drainQueue(t.db, chat, target)).toBe('sent');
  const { run } = await driveToEnd(t, chat, (await postRunId(t.db, postId))!);
  expect(run.status).toBe('succeeded');
}

async function answerOf(postId: string, cache?: AnswerCache) {
  const request = (await getPost(t.db, postId))!;
  return (await requestAnswer(t.db, t.workspaceId, request, cache ? { cache } : {}))!;
}

async function worktreeOf(chat: string): Promise<string> {
  const { rows } = await t.db.query<{ path: string }>(
    'SELECT path FROM chat_worktrees WHERE conversation_id = $1 AND removed_at IS NULL',
    [chat],
  );
  return rows[0]!.path;
}

async function wrapUpBody(): Promise<string> {
  expect(await queueWrapUps(t.db)).toBe(1);
  const all = await listPosts(t.db, outpostId);
  return all.map(({ post }) => post).find((post) => post.toConversationId === lead)!.body;
}

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
  await connectAgents(t);
  const name = `shop-${Date.now()}`;
  worker = startTurnWorker(t, {
    shipAccess: shipAccessTo(stub.url),
    sessions: path.join(base, `sessions-${name}`),
  });
  const chat = await chatOnItsBranch(t, base, name, 'full-auto');
  repo = chat.repo;
  api = chat.conversationId;
  [lead, web] = [await newChat(t), await newChat(t)];
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
  await startStory();
});

afterEach(async () => {
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function projectOf(chat: string): Promise<string> {
  const { rows } = await t.db.query<{ project_id: string }>(
    'SELECT project_id FROM conversation_projects WHERE conversation_id = $1',
    [chat],
  );
  return rows[0]!.project_id;
}

describe('the facts under a story’s answers and in its wrap-up', { timeout: 180_000 }, () => {
  it('say both branches are committed and pushed when both sub-chats published', async () => {
    await answerRequest(api, posts.api);
    await stackWebOnApi(await projectOf(api));
    await answerRequest(web, posts.web);

    const [first, second] = [await answerOf(posts.api), await answerOf(posts.web)];
    expect(first.text).not.toContain('published=');
    expect(first).toMatchObject({
      branch: CHAT_BRANCH,
      changes: ['notes.txt'],
      publish: { committed: true, pushed: true, reason: null },
    });
    expect(first.pullRequests).toHaveLength(1);
    expect(second).toMatchObject({
      branch: WEB_BRANCH,
      publish: { committed: true, pushed: true, reason: null },
    });
    expect(second.changes.length).toBeGreaterThan(0);
    expect(git(repo.bare, 'branch', '--list', 'spark/*').split('\n')).toHaveLength(2);

    const body = await wrapUpBody();
    const [apiLine, webLine] = body.split('\n').slice(1, 3);
    expect(apiLine).toContain(`@api (Orders endpoint): answered · 1 file changed`);
    expect(apiLine).toContain(`committed on ${CHAT_BRANCH} · pushed · pull request https://`);
    expect(webLine).toContain(`committed on ${WEB_BRANCH} · pushed`);
    expect(webLine).toContain('started after @api');
    expect(body).toContain("Spark's own record");

    const view = answerCache();
    expect(await answerOf(posts.api, view)).toEqual(first);
    await writeFile(path.join(await worktreeOf(api), 'later.txt'), 'not committed yet\n');
    expect((await answerOf(posts.api, view)).publish).toEqual(first.publish);
    expect((await answerOf(posts.api)).publish).toMatchObject({ committed: false });
  });

  it('say a sub-chat was not published, with the reason, when its publish step failed', async () => {
    await worker.stop();
    worker = startTurnWorker(t, {
      shipAccess: shipAccessTo(stub.url),
      sessions: path.join(base, `sessions-failing-${Date.now()}`),
      agentEnv: { FAKE_ACP_PUBLISH_FAILS: '1' },
    });
    await answerRequest(api, posts.api);
    await stackWebOnApi(await projectOf(api));
    await t.db.query(
      `UPDATE outpost_posts SET closed_state = 'cancelled', closed_at = now() WHERE id = $1`,
      [posts.web],
    );

    const answer = await answerOf(posts.api);
    expect(answer.publish).toMatchObject({ committed: false, pushed: false });
    expect(answer.publish?.reason).toMatch(/^Not published: the publish step failed\./);
    expect(answer.pullRequests).toEqual([]);

    const apiLine = (await wrapUpBody()).split('\n')[1]!;
    expect(apiLine).toContain(
      'not committed · not pushed · Not published: the publish step failed.',
    );
    expect(apiLine).not.toContain('pull request');
  });
});
