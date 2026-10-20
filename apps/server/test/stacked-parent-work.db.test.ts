import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { releaseAnswered } from '../src/a2a/hold-release.ts';
import { placeChat } from '../src/orchestration/chat-place.ts';
import { parentWorkCommitter } from '../src/outposts/stacked-parent-work.ts';
import { primaryChatWorktree, type ChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getPost } from '../src/persistence/outpost-posts.ts';
import { createProject } from '../src/projects/projects.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { sendDo } from './approval-support.ts';
import { insertRequestRow } from './outpost-fixtures.ts';
import { carry } from './outpost-store-support.ts';
import { git, repoWithRemote, type TestRepo } from './ship-support.ts';
import { dependOn, projectChat } from './stack-support.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, openChat, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';

let t: TestDb;
let base: string;
let worker: Worker | null = null;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-stacked-work-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  await connectAgents(t);
  worker = startTurnWorker(t);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function committer() {
  return parentWorkCommitter({
    db: t.db,
    workspaceId: t.workspaceId,
    secrets: memorySecretStore(),
    runCommand,
    fetch,
    locateGh: async () => null,
    branchPrefix: 'spark',
  });
}

interface Story {
  repo: TestRepo;
  api: string;
  web: string;
  parent: ChatWorktree;
  held: string;
}

async function parentAtAutomatic(name: string, childRoot?: string): Promise<Story> {
  const repo = await repoWithRemote(base, name);
  const api = await openChat(t, { root: repo.root, level: 'hands-off' });
  const runId = await sendMessage(t, api, BUILD, { permission: 'do' });
  await driveToEnd(t, api, runId, undefined, 90_000);
  const parent = (await primaryChatWorktree(t.db, api))!;
  const childProject = childRoot
    ? (await createProject(t.db, t.workspaceId, childRoot)).project.id
    : parent.projectId;
  const web = await projectChat(t, childProject);
  const outpostId = await dependOn(t, api, web);
  const opening = await insertRequestRow(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
  });
  await carry(t, opening, runId);
  const held = await insertRequestRow(t.db, { outpostId, toConversationId: web, toHandle: 'web' });
  await t.db.query('UPDATE outpost_posts SET after_post_id = $2 WHERE id = $1', [held, opening]);
  return { repo, api, web, parent, held };
}

async function waitsFor(postId: string): Promise<string | null> {
  return (await getPost(t.db, postId))!.post.afterPostId;
}

async function childWorktree(web: string): Promise<ChatWorktree> {
  await worker?.stop();
  worker = null;
  const input = await loadRunInput(t.db, await sendDo(t, web, 'Build the page.'));
  await placeChat({ db: t.db, branchPrefix: 'spark' }, input, true);
  return (await primaryChatWorktree(t.db, web))!;
}

describe('a sub-chat stacked on a parent at Automatic', { timeout: 120_000 }, () => {
  it("starts with the parent's kept change, committed on the parent's own branch", async () => {
    const { repo, web, parent, held } = await parentAtAutomatic('kept');
    expect(git(parent.path, 'status', '--porcelain')).toContain('notes.txt');
    const main = git(repo.root, 'rev-parse', 'main');

    expect(await releaseAnswered(t.db, committer())).toBe(1);

    expect(await waitsFor(held)).toBeNull();
    expect(git(parent.path, 'status', '--porcelain')).toBe('');
    expect(git(repo.root, 'show', `${parent.branch}:notes.txt`)).toContain('step 1');
    const child = await childWorktree(web);
    expect(child.baseBranch).toBe(parent.branch);
    expect(await readFile(path.join(child.path, 'notes.txt'), 'utf8')).toContain('step 1');
    expect(git(repo.root, 'rev-parse', 'main')).toBe(main);
    expect(git(repo.bare, 'branch', '--list', parent.branch)).toBe('');
  });

  it('stays held, with nothing skipped, while the commit is refused by a repository hook', async () => {
    const { repo, parent, held } = await parentAtAutomatic('hooked');
    const hook = path.join(repo.root, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);

    expect(await releaseAnswered(t.db, committer())).toBe(0);

    expect(await waitsFor(held)).not.toBeNull();
    expect(git(parent.path, 'status', '--porcelain')).toContain('notes.txt');
    await rm(hook);
    expect(await releaseAnswered(t.db, committer())).toBe(1);
    expect(git(parent.path, 'status', '--porcelain')).toBe('');
  });

  it('is released without a commit when it works in another project', async () => {
    const other = await repoWithRemote(base, 'elsewhere');
    const { parent, held } = await parentAtAutomatic('apart', other.root);

    expect(await releaseAnswered(t.db, committer())).toBe(1);

    expect(await waitsFor(held)).toBeNull();
    expect(git(parent.path, 'status', '--porcelain')).toContain('notes.txt');
  });
});
