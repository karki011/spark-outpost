import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatWorkspace } from '@spark-outpost/contracts';
import { liveChatWorktree, primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { revertRun } from '../src/projects/run-changes.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, gitRepo, openChat, removeRepo, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'Fix the typo in the README heading. #build';

let t: TestDb;
let root: string;
let worker: Worker;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  }).trim();

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  await connectAgents(t);
  worker = startTurnWorker(t);
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
});

async function turn(conversationId: string, text: string, provider = 'claude') {
  const permission = provider === 'claude' ? 'do' : 'ask';
  const runId = await sendMessage(t, conversationId, text, { permission, provider });
  const { run } = await driveToEnd(t, conversationId, runId);
  expect(run.status).toBe('succeeded');
  return runId;
}

async function build(tag: string, folder = root) {
  const conversationId = await openChat(t, { root: folder, level: 'hands-off' });
  const runId = await turn(conversationId, `${BUILD} ${tag}`);
  return { conversationId, runId };
}

const notes = (folder: string) => readFile(join(folder, 'notes.txt'), 'utf8');

async function chatCopy(conversationId: string) {
  const copy = await primaryChatWorktree(t.db, conversationId);
  if (!copy) throw new Error('The chat has no worktree');
  return copy;
}

describe('the worktree of a chat', { timeout: 60_000 }, () => {
  it('gives two chats on one repo their own worktree and branch, and leaves the checkout alone', async () => {
    const [first, second] = await Promise.all([build('#first'), build('#second')]);
    const one = await chatCopy(first.conversationId);
    const two = await chatCopy(second.conversationId);
    expect(one.branch).toMatch(/^spark\/[a-z0-9-]+$/);
    expect(one.branch).not.toBe(two.branch);
    expect(one.path).not.toBe(two.path);
    expect(one.path.startsWith(join(root, '.spark', 'worktrees'))).toBe(true);
    expect(git(one.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(one.branch);
    expect(await notes(one.path)).toContain('step 1');
    expect(await notes(two.path)).toContain('step 1');
    expect(await notes(root)).toBe('start\n');
    expect(git(root, 'status', '--porcelain')).toBe('');
    const summary = (await getConversationDetail(t.db, first.conversationId))!.conversation;
    expect(summary.branch).toBe(one.branch);
  });

  it('is made by the first turn in a changing mode and reused by every later turn', async () => {
    const first = await build('#first');
    const copy = await chatCopy(first.conversationId);
    await turn(first.conversationId, `${BUILD} #again`);
    expect((await chatCopy(first.conversationId)).id).toBe(copy.id);
    expect((await notes(copy.path)).match(/step 1/g)).toHaveLength(2);
    expect(await notes(root)).toBe('start\n');
  });

  it('is not made by a read-only turn', async () => {
    const conversationId = await openChat(t, { root });
    await turn(conversationId, 'What does parseDate do?', 'codex');
    expect(await primaryChatWorktree(t.db, conversationId)).toBeNull();
    expect(git(root, 'branch', '--list', 'spark/*')).toBe('');
  });

  it('is on an existing branch the request names, in its own folder', async () => {
    git(root, 'branch', 'feature-x');
    const tip = git(root, 'rev-parse', 'feature-x');
    const started = await build('on branch feature-x');
    const copy = await chatCopy(started.conversationId);
    expect(copy).toMatchObject({ branch: 'feature-x', inPlace: false, ownsBranch: false });
    expect(await notes(copy.path)).toContain('step 1');
    expect(git(root, 'rev-parse', 'feature-x')).toBe(tip);
    expect(await notes(root)).toBe('start\n');
  });

  it('is the checkout itself when the named branch is checked out and clean', async () => {
    const current = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
    const started = await build(`on the ${current} branch`);
    const copy = await chatCopy(started.conversationId);
    expect(copy).toMatchObject({ branch: current, inPlace: true });
    expect(await notes(root)).toContain('step 1');
    expect(git(root, 'worktree', 'list')).not.toContain('.spark');
  });

  it('is skipped when the user chose the checkout, and the project remembers that', async () => {
    const app = localClient(createTestApp(t));
    const conversationId = await openChat(t, { root, level: 'hands-off' });
    const chosen = await app.send('put', `/api/conversations/${conversationId}/workspace`, {
      place: 'checkout',
    });
    expect((chosen.body as ChatWorkspace).place).toBe('checkout');
    await turn(conversationId, `${BUILD} #here`);
    expect(await notes(root)).toContain('step 1');
    expect(await primaryChatWorktree(t.db, conversationId)).toBeNull();
    const next = await openChat(t, { root });
    const view = await app.get(`/api/conversations/${next}/workspace`);
    expect((view.body as ChatWorkspace).place).toBe('checkout');
  });

  it('is skipped in a folder that is not a git repository', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'spark-plain-')));
    await writeFile(join(plain, 'notes.txt'), 'start\n');
    try {
      const started = await build('#plain', plain);
      expect(await notes(plain)).toContain('step 1');
      expect(await primaryChatWorktree(t.db, started.conversationId)).toBeNull();
      expect(existsSync(join(plain, '.spark'))).toBe(false);
    } finally {
      await removeRepo(plain);
    }
  });

  it('is skipped in a repository with no commits, where there is nothing to branch from', async () => {
    const empty = await realpath(await mkdtemp(join(tmpdir(), 'spark-empty-')));
    execFileSync('git', ['-C', empty, 'init', '-q']);
    await writeFile(join(empty, 'notes.txt'), 'start\n');
    const conversationId = await openChat(t, { root: empty, level: 'hands-off' });
    const runId = await sendMessage(t, conversationId, 'What is in this folder?', {
      permission: 'do',
      agentMode: 'plan',
    });
    const { run } = await driveToEnd(t, conversationId, runId);
    expect(run).toMatchObject({ status: 'succeeded', error: null });
    expect(await primaryChatWorktree(t.db, conversationId)).toBeNull();
    expect(existsSync(join(empty, '.spark', 'worktrees'))).toBe(false);
    await removeRepo(empty);
  });

  it('holds a turn’s changes until they are reverted there', async () => {
    const started = await build('#revert');
    const copy = await chatCopy(started.conversationId);
    expect(await notes(copy.path)).toContain('step 1');
    await revertRun(t.db, t.workspaceId, started.runId);
    expect(await notes(copy.path)).toBe('start\n');
    expect(git(root, 'status', '--porcelain')).toBe('');
  });
});

describe('the chat branch after the turn', { timeout: 60_000 }, () => {
  it('brings the changes into the checkout on request, and refuses while the checkout is dirty', async () => {
    const opened: string[] = [];
    const app = localClient(
      createTestApp(t, { openFolder: async (path) => void opened.push(path) }),
    );
    const started = await build('#bring');
    const copy = await chatCopy(started.conversationId);
    const bring = `/api/conversations/${started.conversationId}/workspace/bring`;
    await writeFile(join(root, 'mine.txt'), 'my edit\n');
    const refused = await app.send('post', bring);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('uncommitted changes (mine.txt)');
    expect(await notes(root)).toBe('start\n');
    git(root, 'add', 'mine.txt');
    git(root, 'commit', '-qm', 'mine');
    const brought = await app.send('post', bring);
    expect(brought.status).toBe(200);
    expect(brought.body.files).toEqual(['notes.txt']);
    expect(await notes(root)).toContain('step 1');
    git(root, 'commit', '-qam', 'took the chat changes');
    const again = await app.send('post', bring);
    expect(again.status).toBe(409);
    expect(again.body.error).toContain('no new changes');
    const open = await app.send(
      'post',
      `/api/conversations/${started.conversationId}/workspace/open`,
    );
    expect(open.status).toBe(204);
    expect(opened).toEqual([copy.path]);
  });

  it('refuses to bring changes that conflict with the checkout', async () => {
    const app = localClient(createTestApp(t));
    const started = await build('#conflict');
    await writeFile(join(root, 'notes.txt'), 'start\nmine instead\n');
    git(root, 'commit', '-qam', 'mine');
    const refused = await app.send(
      'post',
      `/api/conversations/${started.conversationId}/workspace/bring`,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('notes.txt');
    expect(await notes(root)).toBe('start\nmine instead\n');
  });

  it('keeps unpushed work on the branch when the chat is deleted', async () => {
    const app = localClient(createTestApp(t));
    const started = await build('#delete');
    const copy = await chatCopy(started.conversationId);
    const deleted = await app.send('delete', `/api/conversations/${started.conversationId}`);
    expect(deleted.status).toBe(204);
    expect(existsSync(copy.path)).toBe(false);
    expect(git(root, 'show', `${copy.branch}:notes.txt`)).toContain('step 1');
    expect(await liveChatWorktree(t.db, started.conversationId, copy.projectId)).toBeNull();
  });

  it('refuses to change where the chat works once it has a branch', async () => {
    const app = localClient(createTestApp(t));
    const started = await build('#fixed');
    const copy = await chatCopy(started.conversationId);
    const refused = await app.send(
      'put',
      `/api/conversations/${started.conversationId}/workspace`,
      { place: 'checkout' },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain(copy.branch);
  });
});
