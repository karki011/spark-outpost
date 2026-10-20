import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenPull } from '@spark-outpost/contracts';
import { insertChatWorktree, liveChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { AdoptError, adoptPull, openPullsFor, type AdoptDeps } from '../src/projects/adopt-pull.ts';
import type { CommandResult } from '../src/setup/command.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { taskBranch } from '../src/workflow/publish-context.ts';
import { placeChat } from '../src/orchestration/chat-place.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import {
  commandRequest,
  doRun,
  linkedConversation,
  recordingAppend,
  sendDo,
} from './approval-support.ts';
import { git, write } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const ORIGIN = 'https://github.com/acme/widgets.git';
const FORK = 'https://github.com/alice/widgets.git';
const HEAD = 'alice/fix-dates';

let t: TestDb;
let base: string;
let root: string;
let originBare: string;
let forkBare: string;

interface GhPull {
  number: number;
  title: string;
  url: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
  maintainerCanModify: boolean;
  headRepository: { name: string };
  headRepositoryOwner: { login: string };
  state: string;
}

function ghPull(overrides: Partial<GhPull> = {}): GhPull {
  return {
    number: 12,
    title: 'Fix dates',
    url: 'https://github.com/acme/widgets/pull/12',
    author: { login: 'alice' },
    headRefName: HEAD,
    baseRefName: 'main',
    isCrossRepository: false,
    maintainerCanModify: false,
    headRepository: { name: 'widgets' },
    headRepositoryOwner: { login: 'acme' },
    state: 'OPEN',
    ...overrides,
  };
}

function fakeGh(pull: GhPull, protectedHead = false): AdoptDeps['runner'] {
  const calls: string[][] = [];
  const runCommand = async (_file: string, args: string[]): Promise<CommandResult> => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      return { code: 0, stdout: JSON.stringify(pull), stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      return { code: 0, stdout: JSON.stringify([pull]), stderr: '' };
    }
    if (args[0] === 'api') return { code: 0, stdout: String(protectedHead), stderr: '' };
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  return async () => ({ gh: '/usr/bin/false', runCommand });
}

function deps(pull: GhPull, protectedHead = false): AdoptDeps {
  return {
    db: t.db,
    workspaceId: t.workspaceId,
    branchPrefix: 'spark',
    runner: fakeGh(pull, protectedHead),
  };
}

function bareWithBranch(bare: string, branch: string, file: string) {
  const work = path.join(base, `${path.basename(bare)}-work`);
  execFileSync('git', ['clone', '-q', bare, work]);
  git(work, 'config', 'user.email', 'alice@example.test');
  git(work, 'config', 'user.name', 'Alice');
  git(work, 'checkout', '-q', '-b', branch);
  execFileSync('sh', ['-c', `echo fix > ${file}`], { cwd: work });
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'Fix dates');
  git(work, 'push', '-q', 'origin', branch);
  const sha = git(work, 'rev-parse', 'HEAD');
  return sha;
}

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-adopt-')));
  root = path.join(base, 'widgets');
  originBare = path.join(base, 'origin.git');
  forkBare = path.join(base, 'fork.git');
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  git(root, 'config', 'user.name', 'Test Person');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'config', 'commit.gpgsign', 'false');
  await write(root, 'notes.txt', 'one\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'start');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', originBare]);
  execFileSync('git', ['clone', '-q', '--bare', originBare, forkBare]);
  git(root, 'config', `url.${originBare}.insteadOf`, ORIGIN);
  git(root, 'config', `url.${forkBare}.insteadOf`, FORK);
  git(root, 'remote', 'add', 'origin', ORIGIN);
  git(root, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['-C', forkBare, 'fetch', '-q', originBare, 'main:main']);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

function gateFor(runId: string) {
  return createApprovalGate({
    db: t.db,
    runId,
    provider: 'claude',
    mode: 'bypassPermissions',
    changesProject: true,
    append: recordingAppend().append,
    waiters: new ApprovalWaiters(),
    onTimeout: () => undefined,
    backup: async () => undefined,
    publish: { level: 'hands-off', requested: false },
  });
}

const review = async (runId: string, cwd: string, command: string) =>
  gateFor(runId).review(
    { ...commandRequest(cwd, command, randomUUID()), roots: [{ path: cwd, ignore: [] }] },
    new AbortController().signal,
  );

describe('adopting a pull request from the same repository', () => {
  it('checks out the head branch as the chat own branch and lets the agent push to it', async () => {
    bareWithBranch(originBare, HEAD, 'dates.txt');
    const chat = await doRun(t, root);
    const note = await adoptPull(deps(ghPull()), chat.conversationId, {
      projectId: chat.projectId,
      number: 12,
    });
    expect(note).toContain("@alice's pull request #12");

    const record = (await liveChatWorktree(t.db, chat.conversationId, chat.projectId))!;
    expect(record).toMatchObject({
      branch: HEAD,
      ownsBranch: true,
      baseBranch: 'main',
      adopted: { number: 12, author: 'alice', head: HEAD, pushes: true },
    });
    expect(git(record.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(HEAD);

    const task = (await taskBranch(t.db, record.path))!;
    expect(task).toMatchObject({ branch: HEAD, pull: 12, adopted: { author: 'alice', pull: 12 } });

    const { rows } = await t.db.query<{ opened_via: string; follow_up: boolean; task_id: string }>(
      'SELECT opened_via, follow_up, task_id FROM pr_watches WHERE conversation_id = $1',
      [chat.conversationId],
    );
    expect(rows[0]).toMatchObject({ opened_via: 'adopted', follow_up: true });
    expect(rows[0]!.task_id).toBeTruthy();

    expect(await review(chat.runId, record.path, `git push origin ${HEAD}`)).toMatchObject({
      allowed: true,
    });
    expect(
      await review(chat.runId, record.path, `git push --force-with-lease origin ${HEAD}`),
    ).toMatchObject({ allowed: false });
    expect(await review(chat.runId, record.path, 'git push origin main')).toMatchObject({
      allowed: false,
    });

    await write(record.path, 'dates.txt', 'fixed again\n');
    git(record.path, 'commit', '-qam', 'Follow-up fix');
    git(record.path, 'push', '-q', 'origin', HEAD);
    const pushed = execFileSync('git', ['-C', originBare, 'rev-parse', HEAD], { encoding: 'utf8' });
    expect(pushed.trim()).toBe(git(record.path, 'rev-parse', 'HEAD'));
  });

  it('adopts in a new chat before its first message, and the first turn works there', async () => {
    bareWithBranch(originBare, HEAD, 'dates.txt');
    const chat = await linkedConversation(t, root);
    await adoptPull(deps(ghPull()), chat.conversationId, { projectId: chat.projectId, number: 12 });
    const record = (await liveChatWorktree(t.db, chat.conversationId, chat.projectId))!;
    const runId = await sendDo(t, chat.conversationId, 'Fix the review comments');
    const input = await loadRunInput(t.db, runId);
    const placed = await placeChat({ db: t.db, branchPrefix: 'spark' }, input, true);
    expect(placed.input.projectRoots[0]).toBe(record.path);
    expect((await taskBranch(t.db, record.path))?.branch).toBe(HEAD);
  });

  it('lists open pull requests for the project', async () => {
    const chat = await doRun(t, root);
    const listed = await openPullsFor(deps(ghPull()), chat.projectId);
    expect(listed.problem).toBeNull();
    expect(listed.pulls[0]).toMatchObject<Partial<OpenPull>>({ number: 12, author: 'alice' });
  });

  it('works on its own spark branch when GitHub protects the head', async () => {
    const sha = bareWithBranch(originBare, HEAD, 'dates.txt');
    execFileSync('git', ['-C', originBare, 'update-ref', 'refs/pull/12/head', sha]);
    const chat = await doRun(t, root);
    const note = await adoptPull(deps(ghPull(), true), chat.conversationId, {
      projectId: chat.projectId,
      number: 12,
    });
    expect(note).toContain('protected branch');
    const record = (await liveChatWorktree(t.db, chat.conversationId, chat.projectId))!;
    expect(record.branch).toMatch(/^spark\//);
    expect(record.adopted).toMatchObject({ pushes: false });
    expect(git(record.path, 'rev-parse', 'HEAD')).toBe(sha);
  });

  it('refuses a chat that already has a branch of its own', async () => {
    bareWithBranch(originBare, HEAD, 'dates.txt');
    const chat = await doRun(t, root);
    const request = { projectId: chat.projectId, number: 12 };
    await adoptPull(deps(ghPull()), chat.conversationId, request);
    await expect(adoptPull(deps(ghPull()), chat.conversationId, request)).rejects.toBeInstanceOf(
      AdoptError,
    );
  });
});

describe('adopting a pull request from a fork', () => {
  const fork = {
    isCrossRepository: true,
    headRepositoryOwner: { login: 'alice' },
    headRefName: 'fix-dates',
  };

  it("pushes to the fork's branch when maintainers can modify it", async () => {
    bareWithBranch(forkBare, 'fix-dates', 'dates.txt');
    const chat = await doRun(t, root);
    await adoptPull(deps(ghPull({ ...fork, maintainerCanModify: true })), chat.conversationId, {
      projectId: chat.projectId,
      number: 12,
    });
    const record = (await liveChatWorktree(t.db, chat.conversationId, chat.projectId))!;
    expect(record).toMatchObject({ branch: 'fix-dates', adopted: { pushes: true } });
    expect(git(root, 'config', '--get', 'branch.fix-dates.remote')).toBe('pr-alice');
    expect(await review(chat.runId, record.path, 'git push pr-alice fix-dates')).toMatchObject({
      allowed: true,
    });
  });

  it('works on a new spark branch based on it without maintainerCanModify', async () => {
    const sha = bareWithBranch(forkBare, 'fix-dates', 'dates.txt');
    execFileSync('git', ['-C', originBare, 'fetch', '-q', forkBare, `fix-dates:refs/pull/12/head`]);
    const chat = await doRun(t, root);
    const note = await adoptPull(deps(ghPull(fork)), chat.conversationId, {
      projectId: chat.projectId,
      number: 12,
    });
    expect(note).toContain("doesn't allow edits by maintainers");
    const record = (await liveChatWorktree(t.db, chat.conversationId, chat.projectId))!;
    expect(record.branch).toMatch(/^spark\//);
    expect(record.adopted).toMatchObject({ number: 12, pushes: false });
    expect(git(record.path, 'rev-parse', 'HEAD')).toBe(sha);
    expect(git(root, 'remote')).toBe('origin');
    expect(await review(chat.runId, record.path, 'git push origin fix-dates')).toMatchObject({
      allowed: false,
    });
  });
});

describe('adoption only by the user', () => {
  it('a branch picked any other way is never the chat own branch', async () => {
    bareWithBranch(originBare, HEAD, 'dates.txt');
    git(root, 'fetch', '-q', 'origin');
    const chat = await doRun(t, root, `Continue ${HEAD} and push it`);
    const copy = path.join(base, 'copy');
    git(root, 'worktree', 'add', '-q', '--track', '-b', HEAD, copy, `origin/${HEAD}`);
    await insertChatWorktree(t.db, {
      id: randomUUID(),
      conversationId: chat.conversationId,
      projectId: chat.projectId,
      repoRoot: root,
      path: copy,
      branch: HEAD,
      baseBranch: HEAD,
      baseCommit: git(copy, 'rev-parse', 'HEAD'),
      landedCommit: null,
      inPlace: false,
      ownsBranch: false,
    });
    expect(await taskBranch(t.db, copy)).toBeNull();
    expect(await review(chat.runId, copy, `git push origin ${HEAD}`)).toMatchObject({
      allowed: false,
    });
  });

  it.each([
    'POST /api/conversations/:id/workspace/adopt',
    'GET /api/projects/:id/pull-requests/open',
  ])('keeps %s on the Mac', (route) => {
    expect(ROUTE_RULES.get(route)).toBe('never');
  });
});
