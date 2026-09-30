import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { HARNESS_COMMIT_EMAIL } from '../src/projects/snapshot.ts';
import { revertRun } from '../src/projects/run-changes.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  jevFetch,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { FAKE_GH, git, repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let harness: Harness | null = null;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-chat-ship-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
    shipAccess: {
      secrets: memorySecretStore(),
      runCommand,
      fetch,
      apiUrl: stub.url,
      locateGh: async () => FAKE_GH,
    },
  });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await stub.close();
  await t.cleanup();
});

it('opens the Full auto draft PR from the chat branch and leaves the checkout untouched', async () => {
  const repo = await repoWithRemote(base, 'full-auto');
  const { conversationId, runId } = await startScenario(t, repo.root, NORMAL, 'full-auto');
  const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
  expect(orchestration.status).toBe('succeeded');
  const copy = (await primaryChatWorktree(t.db, conversationId))!;
  expect(stub.github.pulls).toHaveLength(1);
  const pull = stub.github.pulls[0]!;
  expect(pull).toMatchObject({ draft: true, head: copy.branch, base: 'main' });
  expect(git(repo.bare, 'diff', '--name-only', 'main', copy.branch)).toBe('notes.txt');
  const authors = git(repo.bare, 'log', '--format=%ae', copy.branch).split('\n');
  expect(authors).not.toContain(HARNESS_COMMIT_EMAIL);
  expect(git(repo.root, 'status', '--porcelain')).toBe('');
  expect(await readFile(path.join(repo.root, 'notes.txt'), 'utf8')).toBe('one\n');
  const detail = (await getConversationDetail(t.db, conversationId))!;
  const reply = detail.messages.map((message) => message.content).join('\n');
  expect(reply).toContain(`The change is on ${copy.branch} in this chat's worktree.`);
}, 120_000);

it('reverts a turn inside the chat worktree', async () => {
  const repo = await repoWithRemote(base, 'revert');
  const { conversationId, runId } = await startScenario(t, repo.root, NORMAL, 'hands-off');
  await driveToEnd(t, conversationId, runId, undefined, 90_000);
  const copy = (await primaryChatWorktree(t.db, conversationId))!;
  expect(await readFile(path.join(copy.path, 'notes.txt'), 'utf8')).toContain('step 1');
  await revertRun(t.db, t.workspaceId, runId);
  expect(await readFile(path.join(copy.path, 'notes.txt'), 'utf8')).toBe('one\n');
  expect(git(repo.root, 'status', '--porcelain')).toBe('');
}, 120_000);
