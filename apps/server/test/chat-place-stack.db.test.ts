import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { placeChat } from '../src/orchestration/chat-place.ts';
import { primaryChatWorktree, type ChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { sendDo } from './approval-support.ts';
import { git, repoWithRemote, write, type TestRepo } from './ship-support.ts';
import { stackedPair, watchedPull, type StackedPair } from './stack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let scratch: string;
let repo: TestRepo;
let pair: StackedPair;

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-place-stack-')));
  repo = await repoWithRemote(scratch, 'shop');
  pair = await stackedPair(t, repo.root);
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

async function place(conversationId: string, message = 'Build it.') {
  const runId = await sendDo(t, conversationId, message);
  const input = await loadRunInput(t.db, runId);
  const placed = await placeChat({ db: t.db, branchPrefix: 'spark' }, input, true);
  const record = await primaryChatWorktree(t.db, conversationId);
  return { placed, record: record! };
}

async function apiWithWork(): Promise<{ record: ChatWorktree; tip: string }> {
  const { record } = await place(pair.api);
  await write(record.path, 'api.ts', 'export const orders = [];\n');
  git(record.path, 'add', '.');
  git(record.path, 'commit', '-qm', 'orders endpoint');
  return { record, tip: git(record.path, 'rev-parse', 'HEAD') };
}

describe("a stacked sub-chat's worktree", { timeout: 60_000 }, () => {
  it("starts its own branch from the parent chat's branch", async () => {
    const api = await apiWithWork();
    const { placed, record } = await place(pair.web);
    expect(record.ownsBranch).toBe(true);
    expect(record.branch).not.toBe(api.record.branch);
    expect(record.branch.startsWith('spark/')).toBe(true);
    expect(record.baseBranch).toBe(api.record.branch);
    expect(record.baseCommit).toBe(api.tip);
    expect(git(record.path, 'rev-parse', 'HEAD')).toBe(api.tip);
    expect(git(record.path, 'symbolic-ref', '--short', 'HEAD')).toBe(record.branch);
    expect(placed.note).toContain(`starts from @api's branch ${api.record.branch}`);
  });

  it('owns a new branch even when the parent branch is checked out nowhere and is named', async () => {
    const api = await apiWithWork();
    git(repo.root, 'worktree', 'remove', '--force', api.record.path);
    const { record } = await place(pair.web, `Continue on the ${api.record.branch} branch.`);
    expect(record.ownsBranch).toBe(true);
    expect(record.branch).not.toBe(api.record.branch);
    expect(record.baseBranch).toBe(api.record.branch);
    expect(git(repo.root, 'rev-parse', api.record.branch)).toBe(api.tip);
  });

  it('leaves the parent chat and an unrelated chat on the default branch', async () => {
    const { record } = await place(pair.api);
    expect(record.baseBranch).toBe('main');
    expect(record.baseCommit).toBe(git(repo.root, 'rev-parse', 'main'));
  });

  it('starts from the default branch, and says so, when the parent has no branch', async () => {
    const { placed, record } = await place(pair.web);
    expect(record.baseBranch).toBe('main');
    expect(placed.note).toContain('@api has no branch to build on');
  });

  it("starts from the default branch once the parent's pull request is merged", async () => {
    const api = await apiWithWork();
    await watchedPull(t, pair.api, api.record.branch, 'merged');
    const { placed, record } = await place(pair.web);
    expect(record.baseBranch).toBe('main');
    expect(record.baseCommit).toBe(git(repo.root, 'rev-parse', 'main'));
    expect(placed.note).toContain('@api has no branch to build on');
  });
});
