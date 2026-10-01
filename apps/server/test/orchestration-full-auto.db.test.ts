import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type Approval } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { getTaskShip } from '../src/persistence/task-ships.ts';
import { BUILDER_PUBLISH_REASON } from '../src/approvals/decide.ts';
import { DESTRUCTIVE_WAIT, RISKY_PR_NOTE } from '../src/orchestration/checkpoint-policy.ts';
import { assumptionPrNote } from '../src/orchestration/clarify.ts';
import { HARNESS_COMMIT_EMAIL } from '../src/projects/snapshot.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import {
  CHECKS_FAILING_NOTE,
  CHECKS_HOLD_REASON,
  KEPT_BY_FULL_AUTO,
  UNVERIFIED_NOTE,
} from '../src/orchestration/full-auto-ship.ts';
import {
  NORMAL,
  answerEverything,
  connectProviders,
  driveToEnd,
  jevFetch,
  setCheckCommands,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import {
  FAKE_GH,
  git,
  repoWithRemote,
  startGitHubStub,
  write,
  type GitHubStub,
  type TestRepo,
} from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let harness: Harness | null = null;
let repo: TestRepo;

const ghState = () => path.join(base, 'gh-state');

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-full-auto-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = ghState();
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await rm(ghState(), { force: true });
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await stub.close();
  await t.cleanup();
});

let repoCount = 0;

async function newRepo(remote: 'github' | 'none' = 'github'): Promise<TestRepo> {
  repoCount += 1;
  repo = await repoWithRemote(base, `widgets-${repoCount}`, remote);
  await write(repo.root, 'mine.txt', 'my own unrelated edit\n');
  return repo;
}

function start(script: Omit<JevScript, 'calls'> = {}, options: { costCapUsd?: number } = {}) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL, ...script }), {
    shipAccess: {
      secrets: memorySecretStore(),
      runCommand,
      fetch,
      apiUrl: stub.url,
      locateGh: async () => FAKE_GH,
    },
    ...(options.costCapUsd === undefined
      ? {}
      : { budget: { costCapUsd: options.costCapUsd }, budgetPollMs: 600_000 }),
  });
}

async function runFullAuto(text = NORMAL.text, answer: Answerer = answerEverything) {
  const { conversationId, runId } = await startScenario(
    t,
    repo.root,
    { ...NORMAL, text },
    'full-auto',
  );
  const result = await driveToEnd(t, conversationId, runId, answer, 90_000);
  const detail = (await getConversationDetail(t.db, conversationId))!;
  const reply = detail.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n');
  const taskId = detail.tasks[0]?.id ?? null;
  const keep = result.orchestration.checkpoints.filter((approval) => approval.kind === 'accept');
  if (process.env.DEBUG_FULL_AUTO) {
    const runs = await t.db.query(
      `SELECT r.role, r.snapshot_root, r.snapshot_kind, r.task_id IS NOT NULL AS task, w.path AS wpath, r.level
       FROM runs r LEFT JOIN run_worktrees w ON w.run_id = r.id ORDER BY r.created_at`,
    );
    console.log(
      reply,
      JSON.stringify(result.asked.map((a) => a.kind)),
      JSON.stringify(runs.rows, null, 1),
    );
  }
  return { ...result, reply, taskId, keep, conversationId, runId };
}

async function configureCheck(source: string): Promise<void> {
  await writeFile(path.join(repo.root, 'check.mjs'), source);
  await setCheckCommands(t, repo.root, ['node check.mjs']);
}

const remoteBranches = () =>
  git(repo.bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n');

function expectAutoKept(keep: readonly Approval[]) {
  expect(keep).toHaveLength(1);
  expect(keep[0]).toMatchObject({
    status: 'allowed',
    decidedBy: 'level',
    decisionOptionId: CHECKPOINT_OPTION.keep,
  });
  expect(keep[0]!.reason).toContain(KEPT_BY_FULL_AUTO);
}

describe('Full auto runs to a draft PR', () => {
  it('keeps the change, commits only the task file on its branch without switching the checkout, pushes and opens a draft PR', async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    start();
    const { orchestration, asked, reply, taskId, keep } = await runFullAuto();
    expect(orchestration.status).toBe('succeeded');
    expect(asked).toEqual([]);
    expectAutoKept(keep);

    expect(stub.github.pulls).toHaveLength(1);
    const pull = stub.github.pulls[0]!;
    expect(pull).toMatchObject({ draft: true, base: 'main', via: 'gh_cli' });
    expect(pull.head).toMatch(new RegExp(`^spark/.+-${taskId!.replaceAll('-', '').slice(0, 8)}$`));
    expect(pull.title).not.toContain(CHECKS_FAILING_NOTE);
    expect(reply).toContain(`Opened draft PR #${pull.number}: ${pull.html_url}`);
    expect(reply).toContain(`Your checkout stays on main`);

    expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(await readFile(path.join(repo.root, 'notes.txt'), 'utf8')).toContain('step 1');
    expect(git(repo.root, 'status', '--porcelain')).toContain('notes.txt');
    expect(remoteBranches()).toContain(pull.head);
    expect(git(repo.bare, 'diff', '--name-only', 'main', pull.head).split('\n')).toEqual([
      'notes.txt',
    ]);
    expect(git(repo.root, 'worktree', 'list').trim().split('\n')).toHaveLength(1);

    const ship = await getTaskShip(t.db, taskId!);
    expect(ship).toMatchObject({ branch: pull.head, keepsCheckout: true, prNumber: pull.number });
    const links = await t.db.query<{ url: string }>(
      `SELECT url FROM task_links WHERE task_id = $1 AND source = 'ship'`,
      [taskId],
    );
    expect(links.rows.map((row) => row.url)).toEqual([pull.html_url]);
    const audit = await t.db.query<{ method: string }>(
      `SELECT method FROM run_protocol_log WHERE kind = 'ship'`,
    );
    expect(audit.rows.map((row) => row.method)).toEqual(['ship/draft_pr']);
  }, 120_000);

  it("refuses the Builder's own push, so only Ship's branch reaches the remote and no internal commit does", async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    start();
    const { orchestration, asked, runId } = await runFullAuto(`${NORMAL.text} #push`);
    expect(orchestration.status).toBe('succeeded');
    expect(asked).toEqual([]);
    const pushes = await t.db.query<{ status: string; decided_by: string; reason: string }>(
      `SELECT a.status, a.decided_by, a.reason FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.kind = 'execute'`,
      [runId],
    );
    expect(pushes.rows).toEqual([
      { status: 'denied', decided_by: 'policy', reason: BUILDER_PUBLISH_REASON },
    ]);
    expect(stub.github.pulls).toHaveLength(1);
    const head = stub.github.pulls[0]!.head;
    expect(remoteBranches().sort()).toEqual(['main', head].sort());
    const authors = git(repo.bare, 'log', '--format=%ae %ce', head).split('\n');
    expect(authors.some((line) => line.includes(HARNESS_COMMIT_EMAIL))).toBe(false);
  }, 120_000);

  it('waits on the plan card for destructive work at Full auto, then flags it in the PR body', async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    start();
    const { orchestration, asked } = await runFullAuto(
      'Rename the runs table column and migrate old rows. #build',
    );
    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.title)).toEqual(['Build this plan?']);
    expect(asked[0]!.payload.checkpoint).toMatchObject({
      autoOption: null,
      waitsFor: DESTRUCTIVE_WAIT,
    });
    expect(orchestration.checkpoints[0]).toMatchObject({ decidedBy: 'user', autoContinueAt: null });
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]!.body).toContain(`**${RISKY_PR_NOTE}**`);
  }, 120_000);

  it('assumes the likeliest reading of a vague request when the agent asks nothing, plans first, and states both in the PR body', async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    const text = 'Make it faster. #build';
    start({ scenario: { ...NORMAL, text, vague: 0.94, intent: 'refactor' } });
    const { orchestration, asked, reply } = await runFullAuto(text);
    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.title)).toEqual(['Build this plan?']);
    expect(reply).toMatch(/Assumed you meant: .+\. Say so if you meant something else\./);
    const assumed = /Assumed you meant: (.+?)\. Say so/.exec(reply)![1]!;
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]!.body).toContain(`**${assumptionPrNote(assumed)}**`);
    expect(stub.github.pulls[0]!.body).toContain('Plan it followed:');
  }, 120_000);

  it('pushes the branch without a PR when GitHub is not connected, and says so', async () => {
    await newRepo();
    start();
    const { orchestration, reply, keep } = await runFullAuto();
    expect(orchestration.status).toBe('succeeded');
    expectAutoKept(keep);
    expect(stub.github.pulls).toEqual([]);
    expect(reply).toMatch(/Pushed spark\/\S+ to origin without a pull request\./);
    expect(reply).toContain('Connect GitHub in Settings → Connectors');
    expect(remoteBranches().some((branch) => branch.startsWith('spark/'))).toBe(true);
    expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  }, 120_000);

  it('commits on the branch when the repository has no remote', async () => {
    await newRepo('none');
    start();
    const { reply, taskId } = await runFullAuto();
    expect(reply).toMatch(/Committed [0-9a-f]{7} on spark\/\S+, not pushed\./);
    expect(reply).toContain('no remote');
    const ship = await getTaskShip(t.db, taskId!);
    expect(git(repo.root, 'log', '-1', '--format=%s', ship!.branch)).toMatch(/^The divider shows/);
    expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  }, 120_000);

  it('opens the draft PR marked "Checks failing" when checks still fail after the fix turns', async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    await configureCheck("console.error('always red'); process.exit(1);\n");
    start();
    const { reply, asked } = await runFullAuto();
    expect(asked).toEqual([]);
    const pull = stub.github.pulls[0]!;
    expect(pull.title.startsWith(`[${CHECKS_FAILING_NOTE}] `)).toBe(true);
    expect(pull.body).toContain(`**${CHECKS_FAILING_NOTE}**`);
    expect(reply).toContain('marked "Checks failing"');
  }, 120_000);

  it('stops at the keep card instead when the setting says not to ship failing checks', async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    await configureCheck("console.error('always red'); process.exit(1);\n");
    await updateProfile(t.db, t.workspaceId, { shipFailingChecks: false });
    start();
    const { asked, orchestration } = await runFullAuto();
    expect(orchestration.status).toBe('succeeded');
    const keep = asked.filter((approval) => approval.kind === 'accept');
    expect(keep).toHaveLength(1);
    expect(keep[0]!.reason).toBe(CHECKS_HOLD_REASON);
    expect(stub.github.pulls).toEqual([]);
    expect(remoteBranches().some((branch) => branch.startsWith('spark/'))).toBe(false);
  }, 120_000);

  it('asks when Jev could not verify, and notes it on the PR after Finish', async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    start({ verdicts: [{ choice: 'declined', confidence: 0.9 }] });
    const { asked } = await runFullAuto();
    expect(asked.map((approval) => approval.kind)).toEqual(['verify']);
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]!.body).toContain(`**${UNVERIFIED_NOTE}**`);
  }, 120_000);

  it('does not ship when Jev could not verify and the user stops', async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    start({ verdicts: [{ choice: 'declined', confidence: 0.9 }] });
    const stop: Answerer = (approval) =>
      approval.kind === 'verify'
        ? { optionId: CHECKPOINT_OPTION.stop }
        : answerEverything(approval);
    const { orchestration, keep } = await runFullAuto(NORMAL.text, stop);
    expect(orchestration.status).toBe('cancelled');
    expect(keep).toEqual([]);
    expect(stub.github.pulls).toEqual([]);
  }, 120_000);

  it('stops at the budget card and does not ship when the user stops there', async () => {
    await newRepo();
    await writeFile(ghState(), 'octo-cli');
    start({}, { costCapUsd: 0.01 });
    const stop: Answerer = (approval) =>
      approval.kind === 'budget'
        ? { optionId: CHECKPOINT_OPTION.stop }
        : answerEverything(approval);
    const { asked, orchestration } = await runFullAuto(`${NORMAL.text} #cost`, stop);
    expect(asked.map((approval) => approval.kind)).toContain('budget');
    expect(orchestration.status).toBe('failed');
    expect(stub.github.pulls).toEqual([]);
  }, 120_000);
});
