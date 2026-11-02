import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { NO_OWN_BRANCH_LINE, parentNotPushedLine } from '../src/orchestration/agent-publish.ts';
import { NO_PULL_REQUEST } from '../src/orchestration/no-pull-request.ts';
import { primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { CHAT_BRANCH, chatOnItsBranch, promptsOf, shipAccessTo } from './publish-step-support.ts';
import { git, repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { dependOn, ownedWorktree, projectChat } from './stack-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, openChat, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';
const PARENT_BRANCH = 'spark/orders-endpoint-1a2b3c4d';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let worker: Worker;
let chats = 0;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-publish-places-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await connectAgents(t);
  chats += 1;
  worker = startTurnWorker(t, {
    shipAccess: shipAccessTo(stub.url),
    sessions: path.join(base, `sessions-${chats}`),
  });
});

afterEach(async () => {
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function turn(conversationId: string, text: string, level: InvolvementLevel = 'full-auto') {
  const runId = await sendMessage(t, conversationId, text, { permission: 'do', level });
  const { run } = await driveToEnd(t, conversationId, runId);
  expect(run.status).toBe('succeeded');
  return { replies: await repliesOf(t, runId), prompts: await promptsOf(t, runId) };
}

describe('where a change stays when there is no pull request to open', { timeout: 120_000 }, () => {
  it('with no remote the agent commits on the chat’s branch and Spark reports the observed commit', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto', 'none');
    const { replies, prompts } = await turn(chat.conversationId, BUILD);

    expect(prompts).toBe(2);
    expect(replies).toHaveLength(2);
    expect(replies[1]).toMatch(
      new RegExp(`HEAD changed to [0-9a-f]{7} on ${CHAT_BRANCH}\\. .*no remote`),
    );
    expect(git(chat.repo.root, 'status', '--porcelain', 'notes.txt')).toBe('');
    expect(git(chat.repo.root, 'log', '-1', '--format=%s', CHAT_BRANCH)).toMatch(
      /^Publish the change/,
    );
  });

  it.each([
    { request: 'Open a PR for this work.', ahead: false },
    { request: 'Push this branch.', ahead: false },
    { request: 'Open a PR for this work.', ahead: true },
    { request: 'Push this branch.', ahead: true },
  ])(
    'does not repeat a local publish turn on a clean checkout: $request (ahead=$ahead)',
    async ({ request, ahead }) => {
      const chat = await chatOnItsBranch(t, base, `clean-${chats}`, 'full-auto', 'none');
      const baseHead = git(chat.repo.root, 'rev-parse', 'HEAD');
      if (ahead) {
        await writeFile(path.join(chat.repo.root, 'notes.txt'), 'already committed work\n');
        git(chat.repo.root, 'add', 'notes.txt');
        git(chat.repo.root, 'commit', '-qm', 'Existing local work');
        expect(git(chat.repo.root, 'rev-list', '--count', `${baseHead}..HEAD`)).toBe('1');
      }
      expect(git(chat.repo.root, 'status', '--porcelain')).toBe('');
      const before = git(chat.repo.root, 'rev-parse', 'HEAD');
      const { prompts } = await turn(chat.conversationId, request);
      expect(prompts).toBe(1);
      expect(git(chat.repo.root, 'rev-parse', 'HEAD')).toBe(before);
    },
  );

  it('includes pre-existing uncommitted work in an explicitly requested local publish', async () => {
    const chat = await chatOnItsBranch(t, base, `existing-${chats}`, 'full-auto', 'none');
    await writeFile(path.join(chat.repo.root, 'notes.txt'), 'pre-existing work\n');
    const before = git(chat.repo.root, 'rev-parse', 'HEAD');
    const { prompts } = await turn(chat.conversationId, 'Open a PR for this work.');
    expect(prompts).toBe(2);
    expect(git(chat.repo.root, 'rev-parse', 'HEAD')).not.toBe(before);
    expect(git(chat.repo.root, 'status', '--porcelain')).toBe('');
  });

  it.each(['none', 'github'] as const)(
    'keeps explicit no-commit work dirty with a %s remote and leaves saved autonomy unchanged',
    async (remote) => {
      const chat = await chatOnItsBranch(t, base, `restricted-${chats}`, 'full-auto', remote);
      const before = git(chat.repo.root, 'rev-parse', 'HEAD');
      const { replies, prompts } = await turn(
        chat.conversationId,
        `${BUILD} Do not commit, push or open a PR. #nocommit`,
      );
      expect(prompts).toBe(2);
      expect(git(chat.repo.root, 'rev-parse', 'HEAD')).toBe(before);
      expect(git(chat.repo.root, 'status', '--porcelain', 'notes.txt')).not.toBe('');
      expect(stub.github.pulls).toEqual([]);
      expect(replies.join('\n')).toContain('Left the changes uncommitted as requested.');
      if (remote === 'none') {
        expect(replies.at(-1)).toContain('No additional commit was made.');
        expect(replies.at(-1)).not.toMatch(/Committed [0-9a-f]{7}/);
      }
      const { rows } = await t.db.query<{ level: string }>(
        "SELECT overrides->'claude'->>'level' AS level FROM conversations WHERE id = $1",
        [chat.conversationId],
      );
      expect(rows[0]?.level).toBe('full-auto');
    },
  );

  it.each(['fails', 'cancels'] as const)(
    'keeps local changes uncommitted when the agent publish continuation %s',
    async (outcome) => {
      await worker.stop();
      worker = startTurnWorker(t, {
        shipAccess: shipAccessTo(stub.url),
        sessions: path.join(base, `sessions-${chats}-failing`),
        agentEnv: {
          [outcome === 'fails' ? 'FAKE_ACP_PUBLISH_FAILS' : 'FAKE_ACP_PUBLISH_CANCELS']: '1',
        },
      });
      const chat = await chatOnItsBranch(t, base, `failed-${chats}`, 'full-auto', 'none');
      const before = git(chat.repo.root, 'rev-parse', 'HEAD');
      const { replies, prompts } = await turn(chat.conversationId, BUILD);
      expect(prompts).toBe(2);
      expect(replies.at(-1)).toContain(
        outcome === 'fails'
          ? 'Not published: the publish step failed.'
          : 'No additional commit was made.',
      );
      expect(git(chat.repo.root, 'rev-parse', 'HEAD')).toBe(before);
      expect(git(chat.repo.root, 'status', '--porcelain', 'notes.txt')).not.toBe('');
      expect(stub.github.pulls).toEqual([]);
    },
  );

  it('a chat working in your checkout keeps the change and pushes nothing', async () => {
    const repo = await repoWithRemote(base, `widgets-${chats}`);
    const conversationId = await openChat(t, { root: repo.root, level: 'full-auto' });
    const { replies, prompts } = await turn(conversationId, BUILD);

    expect(prompts).toBe(1);
    expect(replies[0]).toContain(NO_OWN_BRANCH_LINE);
    expect(await readFile(path.join(repo.root, 'notes.txt'), 'utf8')).toContain('step 1');
    expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(git(repo.bare, 'branch', '--list')).toBe('* main');
    expect(stub.github.pulls).toEqual([]);
  });

  it('a folder that is not a git repository keeps the change with one "No pull request" line', async () => {
    const folder = await mkdtemp(path.join(base, 'plain-'));
    await writeFile(path.join(folder, 'notes.txt'), 'draft\n');
    const conversationId = await openChat(t, { root: folder, level: 'full-auto' });
    const { replies, prompts } = await turn(conversationId, BUILD);

    expect(prompts).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.match(/No pull request/g)).toHaveLength(1);
    expect(replies[0]).toContain(NO_PULL_REQUEST.notGit);
  });

  it('adds no line in those places when the turn changed nothing or the level is Automatic', async () => {
    const repo = await repoWithRemote(base, `widgets-${chats}`);
    const conversationId = await openChat(t, { root: repo.root, level: 'full-auto' });
    const question = await turn(conversationId, 'What does the divider show?');
    const automatic = await turn(conversationId, BUILD, 'hands-off');

    expect(question.replies.join('\n')).not.toContain('Not published');
    expect(automatic.replies.join('\n')).not.toContain('Not published');
  });

  it('a chat without a project gets no publish prompt and no line', async () => {
    const conversationId = await openChat(t, { level: 'full-auto' });
    const { replies, prompts } = await turn(conversationId, 'Hello, open a PR for it');

    expect(prompts).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).not.toMatch(/pull request/i);
  });
});

describe('a stacked chat at Full auto → PR', { timeout: 120_000 }, () => {
  async function stackedTurn(pushed: boolean) {
    const repo = await repoWithRemote(base, `stacked-${chats}`);
    const web = await openChat(t, { root: repo.root, level: 'full-auto' });
    await t.db.query(`UPDATE conversations SET work_place = 'worktree' WHERE id = $1`, [web]);
    const { rows } = await t.db.query<{ project_id: string }>(
      'SELECT project_id FROM conversation_projects WHERE conversation_id = $1',
      [web],
    );
    const projectId = rows[0]!.project_id;
    const api = await projectChat(t, projectId);
    await dependOn(t, api, web);
    git(repo.root, 'branch', PARENT_BRANCH, 'main');
    if (pushed) git(repo.root, 'push', '-q', 'origin', PARENT_BRANCH);
    await ownedWorktree(
      t,
      { conversationId: api, projectId, root: repo.root },
      PARENT_BRANCH,
      'main',
    );
    const said = await turn(web, BUILD);
    return { repo, said, copy: (await primaryChatWorktree(t.db, web))! };
  }

  it('opens its pull request against the parent chat’s branch', async () => {
    const { repo, said, copy } = await stackedTurn(true);

    expect(copy.baseBranch).toBe(PARENT_BRANCH);
    expect(said.prompts).toBe(2);
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]).toMatchObject({ head: copy.branch, base: PARENT_BRANCH });
    expect(git(repo.bare, 'branch', '--list')).toContain(copy.branch);
  });

  it('publishes nothing and says what it waits for while the parent branch is not pushed', async () => {
    const { repo, said, copy } = await stackedTurn(false);

    expect(copy.baseBranch).toBe(PARENT_BRANCH);
    expect(said.prompts).toBe(1);
    expect(stub.github.pulls).toEqual([]);
    expect(git(repo.bare, 'branch', '--list')).not.toContain(copy.branch);
    expect(said.replies.join('\n')).toContain(
      parentNotPushedLine({ branch: PARENT_BRANCH, owner: '@api' }),
    );
  });
});
