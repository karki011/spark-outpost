import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type Approval } from '@spark-outpost/contracts';
import { updateProfile } from '../src/persistence/setup.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { pieceListOf } from './coordinator-parallel-support.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import {
  NORMAL,
  answerEverything,
  connectProviders,
  driveToEnd,
  jevFetch,
  startOrchestrator,
  startScenario,
  withTag,
  type Answerer,
  type Harness,
} from './orchestration-support.ts';
import { FAKE_GH, git, repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let harness: Harness | null = null;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-split-')));
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
  await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
    coordinator: 'parallel',
    forcedPlacement: 'worktree',
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

async function runWorktreePieces(name: string, answer: Answerer) {
  const repo = await repoWithRemote(base, name);
  await writeFile(path.join(repo.root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  await mkdir(path.join(repo.root, 'migrations'), { recursive: true });
  await writeFile(path.join(repo.root, 'migrations', '0001_init.sql'), '-- init\n');
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-qm', 'piece check');
  git(repo.root, 'push', '-q', 'origin', 'main');
  const scenario = withTag(NORMAL, 'Split this up. #pieces #parallel');
  const { conversationId, runId } = await startScenario(
    t,
    repo.root,
    scenario,
    'full-auto',
    'auto',
    'sonnet',
    'acceptEdits',
  );
  const driven = await driveToEnd(t, conversationId, runId, answer, 120_000);
  return { ...driven, runId, repo };
}

const leavePrSplit: Answerer = (approval) =>
  approval.kind === 'pr_split' ? null : answerEverything(approval);

async function prSplitCards(runId: string) {
  const { rows } = await t.db.query<{
    decided_by: string | null;
    decision_option_id: string | null;
  }>(
    `SELECT decided_by, decision_option_id FROM approvals
     WHERE run_id = $1 AND kind = 'pr_split'`,
    [runId],
  );
  return rows;
}

async function rememberedSplit(): Promise<string | null> {
  const { rows } = await t.db.query<{ pr_split: string | null }>(
    'SELECT pr_split FROM projects WHERE workspace_id = $1',
    [t.workspaceId],
  );
  return rows[0]?.pr_split ?? null;
}

describe('one PR or separate PRs for worktree pieces', { timeout: 180_000 }, () => {
  it('asks once and ships one draft PR when nobody answers', async () => {
    const { orchestration, runId } = await runWorktreePieces('one-pr', leavePrSplit);
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceListOf(t, runId);
    expect(list.pieces.every((piece) => piece.placement === 'worktree')).toBe(true);
    expect(await prSplitCards(runId)).toEqual([
      { decided_by: 'auto', decision_option_id: CHECKPOINT_OPTION.onePr },
    ]);
    expect(stub.github.pulls).toHaveLength(1);
    expect(await rememberedSplit()).toBeNull();
  });

  it('opens one draft PR per worktree piece and remembers the choice for the project', async () => {
    const separate: Answerer = (approval: Approval) =>
      approval.kind === 'pr_split'
        ? { optionId: CHECKPOINT_OPTION.alwaysSeparatePrs }
        : answerEverything(approval);
    const { orchestration, runId, repo } = await runWorktreePieces('separate-prs', separate);
    expect(orchestration.status).toBe('succeeded');
    const heads = stub.github.pulls.map((pull) => String(pull.head));
    expect(heads).toHaveLength(3);
    expect(heads.map((head) => head.slice(-3)).sort()).toEqual(['-p1', '-p2', '-p3']);
    const p1 = heads.find((head) => head.endsWith('-p1'))!;
    expect(git(repo.bare, 'diff', '--name-only', 'main', p1).trim()).toBe('store.ts');
    expect(await rememberedSplit()).toBe('separate');
    expect(await prSplitCards(runId)).toHaveLength(1);
  });
});
