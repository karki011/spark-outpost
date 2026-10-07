import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { pieceListOf } from './coordinator-parallel-support.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  jevFetch,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
} from './orchestration-support.ts';
import { FAKE_GH, git, repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let harness: Harness | null = null;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-shared-ship-')));
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
    coordinator: 'parallel',
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

it('keeps both sequential shared-tree pieces’ files through to the Full auto draft PR', async () => {
  const repo = await repoWithRemote(base, 'shared-pieces');
  await writeFile(path.join(repo.root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-qm', 'piece check');
  git(repo.root, 'push', '-q', 'origin', 'main');
  const scenario = withTag(NORMAL, 'Split this up. #pieces #parallel #heredoc');
  const { conversationId, runId } = await startScenario(
    t,
    repo.root,
    scenario,
    'full-auto',
    'auto',
    'sonnet',
    'acceptEdits',
  );
  const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
  expect(orchestration.status).toBe('succeeded');
  const list = await pieceListOf(t, runId);
  expect(list.placement).toBe('shared');
  expect(list.pieces.map((piece) => [piece.key, piece.status, piece.filesChanged])).toEqual([
    ['P1', 'landed', ['store.ts']],
    ['P2', 'landed', ['api.ts']],
    ['P3', 'landed', ['view.ts']],
  ]);
  const copy = (await primaryChatWorktree(t.db, conversationId))!;
  expect(stub.github.pulls).toHaveLength(1);
  expect(stub.github.pulls[0]).toMatchObject({ draft: false, head: copy.branch });
  const shipped = git(repo.bare, 'diff', '--name-only', 'main', copy.branch).split('\n');
  expect(shipped).toEqual(expect.arrayContaining(['store.ts', 'api.ts', 'view.ts']));
  expect(git(repo.bare, 'show', `${copy.branch}:store.ts`)).toContain('built by P1');
  expect(git(repo.bare, 'show', `${copy.branch}:view.ts`)).toContain('built by P3');
}, 120_000);
