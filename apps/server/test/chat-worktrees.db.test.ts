import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { modeForLegacy, type ChatWorkspace } from '@spark-outpost/contracts';
import { liveChatWorktree, primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestApp, localClient } from './app-support.ts';
import { linkedConversation } from './approval-support.ts';
import {
  QUESTION,
  TRIVIAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const WORKTREE_TEST_MS = 60_000;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  }).trim();

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch({ calls: [] }));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function doTurn(text: string, conversationId?: string) {
  const scenario = withTag(TRIVIAL, text);
  const started = conversationId
    ? await continueChat(conversationId, scenario.text)
    : await startScenario(t, root, scenario, 'hands-off');
  await driveToEnd(t, started.conversationId, started.runId);
  return started;
}

async function continueChat(conversationId: string, text: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: text },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: 'do',
      agentMode: modeForLegacy('claude', 'do', 'hands-off'),
      level: 'hands-off',
    },
  );
  return { conversationId, runId: sent.run.id };
}

const notes = (folder: string) => readFile(join(folder, 'notes.txt'), 'utf8');

async function chatCopy(conversationId: string) {
  const copy = await primaryChatWorktree(t.db, conversationId);
  if (!copy) throw new Error('The chat has no worktree');
  return copy;
}

describe('a chat worktree per Do chat', { timeout: WORKTREE_TEST_MS }, () => {
  it('gives two chats on one repo their own worktree and branch, and leaves the checkout alone', async () => {
    const [first, second] = await Promise.all([doTurn('#first'), doTurn('#second')]);
    const one = await chatCopy(first.conversationId);
    const two = await chatCopy(second.conversationId);
    expect(one.branch).toMatch(/^spark\/[a-z0-9-]+$/);
    expect(two.branch).toMatch(/^spark\/[a-z0-9-]+$/);
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

  it('reuses the same worktree and branch for every turn of the chat', async () => {
    const first = await doTurn('#first');
    const copy = await chatCopy(first.conversationId);
    await doTurn('#again', first.conversationId);
    const again = await chatCopy(first.conversationId);
    expect(again.id).toBe(copy.id);
    expect((await notes(copy.path)).match(/step 1/g)).toHaveLength(2);
    expect(await notes(root)).toBe('start\n');
  });

  it('answers a question without a worktree, and makes one once the chat changes files', async () => {
    const asked = await startScenario(t, root, { ...QUESTION, mode: 'do' }, 'hands-off');
    await driveToEnd(t, asked.conversationId, asked.runId);
    expect(await primaryChatWorktree(t.db, asked.conversationId)).toBeNull();
    expect(git(root, 'branch', '--list', 'spark/*')).toBe('');
    await doTurn('#first', asked.conversationId);
    const copy = await chatCopy(asked.conversationId);
    expect(copy.branch).toMatch(/^spark\//);
    expect(await notes(copy.path)).toContain('step 1');
  });

  it("runs commands without asking on Automatic in the chat's worktree", async () => {
    await doTurn('#pnpmbuild');
    const { rows } = await t.db.query<{ status: string; decided_by: string }>(
      `SELECT status, decided_by FROM approvals WHERE payload->>'command' = 'pnpm build'`,
    );
    expect(rows).toEqual([{ status: 'allowed', decided_by: 'level' }]);
  });

  it('works on an existing branch the request names, in its own worktree', async () => {
    git(root, 'branch', 'feature-x');
    const tip = git(root, 'rev-parse', 'feature-x');
    const started = await doTurn('on branch feature-x');
    const copy = await chatCopy(started.conversationId);
    expect(copy).toMatchObject({ branch: 'feature-x', inPlace: false, ownsBranch: false });
    expect(await notes(copy.path)).toContain('step 1');
    expect(git(root, 'rev-parse', 'feature-x')).toBe(tip);
    expect(await notes(root)).toBe('start\n');
  });

  it('works in place when the named branch is checked out and clean', async () => {
    const current = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
    const started = await doTurn(`on the ${current} branch`);
    const copy = await chatCopy(started.conversationId);
    expect(copy).toMatchObject({ branch: current, inPlace: true });
    expect(await notes(root)).toContain('step 1');
    expect(git(root, 'worktree', 'list')).not.toContain('.spark');
  });

  it('works in the checkout when the user chose it, and remembers that for the project', async () => {
    const app = localClient(createTestApp(t));
    const { conversationId } = await linkedConversation(t, root);
    const chosen = await app.send('put', `/api/conversations/${conversationId}/workspace`, {
      place: 'checkout',
    });
    expect(chosen.status).toBe(200);
    expect((chosen.body as ChatWorkspace).place).toBe('checkout');
    const started = await continueChat(conversationId, withTag(TRIVIAL, '#here').text);
    await driveToEnd(t, conversationId, started.runId);
    expect(await notes(root)).toContain('step 1');
    expect(await primaryChatWorktree(t.db, conversationId)).toBeNull();
    const next = await linkedConversation(t, root);
    const view = await app.get(`/api/conversations/${next.conversationId}/workspace`);
    expect((view.body as ChatWorkspace).place).toBe('checkout');
  });

  it('works in place in a folder that is not a git repository', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'spark-plain-')));
    await writeFile(join(plain, 'notes.txt'), 'start\n');
    try {
      const scenario = withTag(TRIVIAL, '#plain');
      const started = await startScenario(t, plain, scenario, 'hands-off');
      await driveToEnd(t, started.conversationId, started.runId);
      expect(await notes(plain)).toContain('step 1');
      expect(await primaryChatWorktree(t.db, started.conversationId)).toBeNull();
      expect(existsSync(join(plain, '.spark'))).toBe(false);
    } finally {
      await removeRepo(plain);
    }
  });
});

describe('the chat branch after the turn', { timeout: WORKTREE_TEST_MS }, () => {
  it('brings the changes into the checkout on request, and refuses while the checkout is dirty', async () => {
    const opened: string[] = [];
    const app = localClient(
      createTestApp(t, { openFolder: async (path) => void opened.push(path) }),
    );
    const started = await doTurn('#bring');
    const copy = await chatCopy(started.conversationId);
    await writeFile(join(root, 'mine.txt'), 'my edit\n');
    const refused = await app.send(
      'post',
      `/api/conversations/${started.conversationId}/workspace/bring`,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('uncommitted changes (mine.txt)');
    expect(await notes(root)).toBe('start\n');
    git(root, 'add', 'mine.txt');
    git(root, 'commit', '-qm', 'mine');
    const brought = await app.send(
      'post',
      `/api/conversations/${started.conversationId}/workspace/bring`,
    );
    expect(brought.status).toBe(200);
    expect(brought.body.files).toEqual(['notes.txt']);
    expect(await notes(root)).toContain('step 1');
    git(root, 'commit', '-qam', 'took the chat changes');
    const again = await app.send(
      'post',
      `/api/conversations/${started.conversationId}/workspace/bring`,
    );
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
    const started = await doTurn('#conflict');
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
    const started = await doTurn('#delete');
    const copy = await chatCopy(started.conversationId);
    const deleted = await app.send('delete', `/api/conversations/${started.conversationId}`);
    expect(deleted.status).toBe(204);
    expect(existsSync(copy.path)).toBe(false);
    expect(git(root, 'show', `${copy.branch}:notes.txt`)).toContain('step 1');
    expect(await liveChatWorktree(t.db, started.conversationId, copy.projectId)).toBeNull();
  });

  it('refuses to change where the chat works once it has a branch', async () => {
    const app = localClient(createTestApp(t));
    const started = await doTurn('#fixed');
    const copy = await chatCopy(started.conversationId);
    const refused = await app.send(
      'put',
      `/api/conversations/${started.conversationId}/workspace`,
      {
        place: 'checkout',
      },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain(copy.branch);
  });
});
