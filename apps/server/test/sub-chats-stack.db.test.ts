import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stackedPushRefusal } from '../src/approvals/stacked-push.ts';
import { placeChat } from '../src/orchestration/chat-place.ts';
import {
  chatWorktreeAt,
  primaryChatWorktree,
  type ChatWorktree,
} from '../src/persistence/chat-worktrees.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { withTransaction } from '../src/persistence/db.ts';
import { insertSubChat } from '../src/persistence/sub-chats.ts';
import { createProject } from '../src/projects/projects.ts';
import { stackParentOf } from '../src/sub-chats/stack-base.ts';
import { stackGit } from '../src/sub-chats/stack-git.ts';
import { publishStackOf } from '../src/sub-chats/stack-publish.ts';
import { taskBranch } from '../src/workflow/publish-context.ts';
import { chatTarget } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { startHeldSubChat } from '../src/sub-chats/start.ts';
import { sendDo } from './approval-support.ts';
import { turnsOf } from './chat-ask-fixtures.ts';
import { git, repoWithRemote, write, type TestRepo } from './ship-support.ts';
import { ownedWorktree, watchedPull } from './stack-support.ts';
import { STARTED_WITH } from './sub-chat-fixtures.ts';
import { parentChat, startedPlan, THREE_PIECES } from './sub-chat-plan-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

const API = 'spark/orders-api-1a2b3c4d';
const PAGE = 'spark/orders-page-5e6f7a8b';

let t: TestDb;
let scratch: string;
let repo: TestRepo;
let projectId: string;
let parent: string;
let api: string;
let page: string;

async function chatIn(project: string, title: string): Promise<string> {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id, { projectIds: [project] });
  await t.db.query(`UPDATE conversations SET title = $2, title_source = 'user' WHERE id = $1`, [
    id,
    title,
  ]);
  return id;
}

async function subChatIn(project: string, title: string, stackedOn: string | null = null) {
  const conversationId = await chatIn(project, title);
  await withTransaction(t.db, (client) =>
    insertSubChat(client, {
      conversationId,
      parentConversationId: parent,
      task: `Build ${title}.`,
      stackedOn,
      startsAfter: [],
      startedWith: STARTED_WITH,
      approvalId: null,
    }),
  );
  return conversationId;
}

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-sub-chat-stack-')));
  repo = await repoWithRemote(scratch, 'shop');
  projectId = (await createProject(t.db, t.workspaceId, repo.root)).project.id;
  parent = await chatIn(projectId, 'Checkout rework');
  api = await subChatIn(projectId, 'Orders API');
  page = await subChatIn(projectId, 'Orders page', api);
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

const placeOf = (conversationId: string) => ({ conversationId, projectId, root: repo.root });

describe('the branch a stacked sub-chat builds on', () => {
  it('is the own branch of the sub-chat it is stacked on, named by its title', async () => {
    await ownedWorktree(t, placeOf(api), API, 'main');
    expect(await stackParentOf(t.db, page)).toEqual({
      parentChatId: api,
      owner: '“Orders API”',
      branch: API,
    });
  });

  it('is nothing for a sub-chat that is not stacked, and for a chat that is no sub-chat', async () => {
    await ownedWorktree(t, placeOf(api), API, 'main');
    const docs = await subChatIn(projectId, 'Docs');
    await t.db.query('UPDATE sub_chats SET starts_after = $2 WHERE conversation_id = $1', [
      docs,
      [api],
    ]);
    expect(await stackParentOf(t.db, api)).toBeNull();
    expect(await stackParentOf(t.db, docs)).toBeNull();
    expect(await stackParentOf(t.db, parent)).toBeNull();
  });

  it('names the sub-chat but no branch while it has none, or works on a branch it does not own', async () => {
    expect(await stackParentOf(t.db, page)).toEqual({
      parentChatId: api,
      owner: '“Orders API”',
      branch: null,
    });
    const id = await ownedWorktree(t, placeOf(api), 'feature/login', 'feature/login');
    await t.db.query('UPDATE chat_worktrees SET owns_branch = false WHERE id = $1', [id]);
    expect((await stackParentOf(t.db, page))?.branch).toBeNull();
  });

  it('is nothing when the two sub-chats work in different projects', async () => {
    const site = await repoWithRemote(scratch, 'site');
    const other = (await createProject(t.db, t.workspaceId, site.root)).project.id;
    const elsewhere = await subChatIn(other, 'Site page', api);
    await ownedWorktree(t, placeOf(api), API, 'main');
    expect(await stackParentOf(t.db, elsewhere)).toBeNull();
  });

  it('has no branch once that sub-chat’s pull request is merged or closed', async () => {
    await ownedWorktree(t, placeOf(api), API, 'main');
    await watchedPull(t, api, API, 'open');
    expect((await stackParentOf(t.db, page))?.branch).toBe(API);
    for (const state of ['merged', 'closed']) {
      await t.db.query('UPDATE pr_watches SET pr_state = $1', [state]);
      expect((await stackParentOf(t.db, page))?.branch).toBeNull();
    }
  });

  it('is nothing after the sub-chat it was stacked on is deleted', async () => {
    await ownedWorktree(t, placeOf(api), API, 'main');
    await deleteConversation(t.db, t.workspaceId, api);
    expect(await stackParentOf(t.db, page)).toBeNull();
  });
});

describe('a stacked sub-chat’s worktree', { timeout: 60_000 }, () => {
  async function place(conversationId: string) {
    const runId = await sendDo(t, conversationId, 'Build it.');
    const input = await loadRunInput(t.db, runId);
    const placed = await placeChat({ db: t.db, branchPrefix: 'spark' }, input, true);
    return { placed, record: (await primaryChatWorktree(t.db, conversationId))! };
  }

  it('starts its own branch from the branch of the sub-chat it is stacked on', async () => {
    const base = await place(api);
    await write(base.record.path, 'api.ts', 'export const orders = [];\n');
    git(base.record.path, 'add', '.');
    git(base.record.path, 'commit', '-qm', 'orders endpoint');
    const tip = git(base.record.path, 'rev-parse', 'HEAD');

    const { placed, record } = await place(page);

    expect(base.record.baseBranch).toBe('main');
    expect(record.ownsBranch).toBe(true);
    expect(record.branch).not.toBe(base.record.branch);
    expect(record.branch.startsWith('spark/orders-page')).toBe(true);
    expect(record.baseBranch).toBe(base.record.branch);
    expect(record.baseCommit).toBe(tip);
    expect(git(record.path, 'rev-parse', 'HEAD')).toBe(tip);
    expect(placed.note).toContain(`starts from “Orders API”'s branch ${base.record.branch}`);
  });

  it('starts from the default branch, and says so, when that sub-chat has no branch', async () => {
    const { placed, record } = await place(page);
    expect(record.baseBranch).toBe('main');
    expect(placed.note).toContain('“Orders API” has no branch to build on');
  });
});

describe('a plan with a stacked piece, started by the agent', { timeout: 60_000 }, () => {
  it('bases the stacked sub-chat’s worktree on the branch below after Start anyway', async () => {
    await connectCliProvider(t, 'claude');
    const lead = await parentChat(t, { id: projectId, root: repo.root });
    const target = chatTarget(t.db);
    const [first, second] = await startedPlan(t, lead, THREE_PIECES, target);
    const placeTurn = async (conversationId: string) => {
      const [turn] = await turnsOf(t, conversationId);
      const input = await loadRunInput(t.db, turn!.id);
      await placeChat({ db: t.db, branchPrefix: 'spark' }, input, true);
      return (await primaryChatWorktree(t.db, conversationId))!;
    };
    const below = await placeTurn(first!.conversation_id);
    await write(below.path, 'api.ts', 'export const orders = [];\n');
    git(below.path, 'add', '.');
    git(below.path, 'commit', '-qm', 'orders endpoint');

    const held = await startHeldSubChat(
      { db: t.db, workspaceId: t.workspaceId, resolveTarget: target },
      second!.conversation_id,
      'test',
    );
    const stacked = await placeTurn(second!.conversation_id);

    expect(held).toEqual({ started: true, delivered: 'started' });
    expect(below.branch.startsWith('spark/orders-api')).toBe(true);
    expect(stacked.baseBranch).toBe(below.branch);
    expect(stacked.baseCommit).toBe(git(below.path, 'rev-parse', 'HEAD'));
    expect((await taskBranch(t.db, stacked.path))?.stackBase).toMatchObject({
      branch: below.branch,
      owner: '“Orders API”',
      onRemote: false,
    });
  });
});

describe('what a stacked sub-chat publishes against', { timeout: 30_000 }, () => {
  let pagePath: string;

  beforeEach(async () => {
    git(repo.root, 'branch', API);
    git(repo.root, 'branch', PAGE, API);
    pagePath = join(scratch, 'page-copy');
    await ownedWorktree(t, placeOf(api), API, 'main');
    await ownedWorktree(t, { ...placeOf(page), path: pagePath }, PAGE, API);
  });

  const worktree = async (): Promise<ChatWorktree> => (await chatWorktreeAt(t.db, pagePath))!;
  const stack = async () => publishStackOf(t.db, stackGit, await worktree());

  it('is the branch it is stacked on while the stack is live, and knows it is not pushed', async () => {
    expect(await stack()).toEqual({
      pullBase: API,
      stackBase: { branch: API, owner: '“Orders API”', onRemote: false },
    });
    git(repo.root, 'push', '-q', 'origin', API);
    expect((await stack())?.stackBase?.onRemote).toBe(true);
  });

  it('refuses a push of its branch while the branch below is not on the remote', async () => {
    const task = await taskBranch(t.db, pagePath);
    expect(task).toMatchObject({
      branch: PAGE,
      pullBase: API,
      stackBase: { branch: API, owner: '“Orders API”', onRemote: false },
    });
    expect(task!.protectedBranches).toContain(API);
    expect(stackedPushRefusal(`git push origin ${PAGE}`, task)).toContain(
      `it is built on “Orders API”'s branch ${API}, which is not on the remote`,
    );
    git(repo.root, 'push', '-q', 'origin', API);
    expect(
      stackedPushRefusal(`git push origin ${PAGE}`, await taskBranch(t.db, pagePath)),
    ).toBeNull();
  });

  it('stays that branch while its pull request is open, and is the default branch after', async () => {
    await watchedPull(t, api, API, 'open');
    expect((await stack())?.pullBase).toBe(API);
    for (const state of ['merged', 'closed']) {
      await t.db.query('UPDATE pr_watches SET pr_state = $1', [state]);
      expect(await stack()).toEqual({ pullBase: 'main', stackBase: null });
    }
  });

  it('is the default branch once the sub-chat below is deleted or its branch is gone', async () => {
    git(repo.root, 'branch', '-qD', API);
    expect(await stack()).toEqual({ pullBase: 'main', stackBase: null });
    git(repo.root, 'branch', API);
    await deleteConversation(t.db, t.workspaceId, api);
    expect(await stack()).toEqual({ pullBase: 'main', stackBase: null });
  });

  it('says nothing for a sub-chat on the default branch, or for a chat that is no sub-chat', async () => {
    const own = (
      await t.db.query<{ path: string }>(
        'SELECT path FROM chat_worktrees WHERE conversation_id = $1',
        [api],
      )
    ).rows[0]!;
    const apiTree = (await chatWorktreeAt(t.db, own.path))!;
    expect(await publishStackOf(t.db, stackGit, apiTree)).toBeNull();
    await t.db.query('DELETE FROM sub_chats WHERE conversation_id = $1', [page]);
    expect(await stack()).toBeNull();
    expect(await taskBranch(t.db, pagePath)).toEqual({
      branch: PAGE,
      protectedBranches: ['main', 'master', API],
      pull: null,
    });
  });
});
