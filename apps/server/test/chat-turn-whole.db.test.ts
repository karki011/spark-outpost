import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { otherBranchReason } from '../src/approvals/publish-policy.ts';
import { chatWorktreesOf } from '../src/persistence/chat-worktrees.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import { OUTPOST_REQUEST_METHOD } from '../src/outposts/request-audit.ts';
import { wrapRequest } from '../src/outposts/request-prompt.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { runChatTurn } from '../src/workflow/chat-turn.ts';
import { KEPT_RECORD_TITLE } from '../src/workflow/kept-record-writer.ts';
import { chatTarget, drainQueue } from '../src/workflow/queue-drain.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { plansOf } from './chat-plan-support.ts';
import { FAKE_PLAN } from './fake-acp-plans.ts';
import { addMemberChat, createOutpostRow, deliverRequest, postRunId } from './outpost-fixtures.ts';
import { promptsOf } from './publish-step-support.ts';
import {
  FAKE_GH,
  git,
  repoWithRemote,
  startGitHubStub,
  type GitHubStub,
  type TestRepo,
} from './ship-support.ts';
import { createTestDb, eventTypes, eventually, type TestDb } from './support.ts';
import {
  auditOf,
  changesOf,
  driveToEnd,
  openChat,
  repliesOf,
  sendMessage,
  type MessageOptions,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';
const MANUAL = 'default';

let t: TestDb;
let base: string;
let repo: TestRepo;
let stub: GitHubStub;
let worker: Worker;
let repos = 0;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-chat-turn-whole-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
  repos += 1;
  repo = await repoWithRemote(base, `widgets-${repos}`);
  await connectAgents(t);
  worker = startTurnWorker(t, {
    runTurn: runChatTurn,
    sessions: path.join(base, `sessions-${repos}`),
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
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function turn(conversationId: string, text: string, options: MessageOptions = {}) {
  const runId = await sendMessage(t, conversationId, text, options);
  const { run, asked } = await driveToEnd(t, conversationId, runId);
  return { run, runId, asked, replies: await repliesOf(t, runId) };
}

function projectChat(level: InvolvementLevel) {
  return openChat(t, { root: repo.root, level });
}

async function worktreeOf(conversationId: string) {
  const [worktree] = await chatWorktreesOf(t.db, conversationId);
  return worktree!;
}

async function runsOf(conversationId: string) {
  const { rows } = await t.db.query<{ id: string; role: string | null; parent: string | null }>(
    'SELECT id, role, parent_run_id AS parent FROM runs WHERE conversation_id = $1',
    [conversationId],
  );
  return rows;
}

interface KeptRow {
  title: string;
  kept: { keptBy: string; keptAt: { branch: string; commit: string | null } };
}

async function keptRecords(runId: string): Promise<KeptRow[]> {
  const { rows } = await t.db.query<KeptRow>(
    `SELECT title, payload->'checkpoint' AS kept FROM approvals
     WHERE run_id = $1 AND kind = 'accept' ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function decided(runId: string, command: string) {
  const { rows } = await t.db.query<{ status: string; reason: string | null; by: string | null }>(
    `SELECT status, reason, decided_by AS by FROM approvals
     WHERE run_id = $1 AND payload->>'command' = $2`,
    [runId, command],
  );
  return rows;
}

async function pullWatches(conversationId: string) {
  const { rows } = await t.db.query<{ number: number; branch: string }>(
    'SELECT number, branch FROM pr_watches WHERE conversation_id = $1',
    [conversationId],
  );
  return rows;
}

const onRemote = (branch: string) => git(repo.bare, 'branch', '--list', branch) !== '';

describe('a whole chat turn on the chat’s own run', { timeout: 120_000 }, () => {
  it('answers a question in one run and one reply, with nothing of Spark’s around it', async () => {
    const conversationId = await openChat(t);

    const { run, runId, replies } = await turn(conversationId, 'What is a lease?');

    expect(run).toMatchObject({ status: 'succeeded', role: null });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('\nWhat is a lease?\n');
    expect(await runsOf(conversationId)).toEqual([{ id: runId, role: null, parent: null }]);
    expect(await loadOrchestration(t.db, runId)).toBeNull();
    expect(await keptRecords(runId)).toEqual([]);
  });

  it('keeps a change in the chat’s worktree at Automatic and publishes nothing', async () => {
    const conversationId = await projectChat('hands-off');

    const { run, runId, replies } = await turn(conversationId, BUILD, { permission: 'do' });

    expect(run.status).toBe('succeeded');
    const worktree = await worktreeOf(conversationId);
    expect(worktree).toMatchObject({ repoRoot: repo.root, inPlace: false, ownsBranch: true });
    expect(await readFile(path.join(worktree.path, 'notes.txt'), 'utf8')).toContain('step 1');
    expect(await readFile(path.join(repo.root, 'notes.txt'), 'utf8')).toBe('one\n');
    expect(await changesOf(t, runId)).toMatchObject({
      revertible: true,
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
    expect(await keptRecords(runId)).toMatchObject([
      {
        title: KEPT_RECORD_TITLE,
        kept: { keptBy: 'hands-off', keptAt: { branch: worktree.branch, commit: null } },
      },
    ]);
    expect(replies).toHaveLength(1);
    expect(await promptsOf(t, runId)).toBe(1);
    expect(onRemote(worktree.branch)).toBe(false);
    expect(stub.github.pulls).toEqual([]);
    expect(await runsOf(conversationId)).toHaveLength(1);
  });

  it('ends a change at Full auto → PR with one pull request, opened by the same run', async () => {
    const conversationId = await projectChat('full-auto');

    const { run, runId, replies } = await turn(conversationId, BUILD, {
      permission: 'do',
      level: 'full-auto',
    });

    expect(run.status).toBe('succeeded');
    const { branch } = await worktreeOf(conversationId);
    expect(await promptsOf(t, runId)).toBe(2);
    expect(replies).toHaveLength(2);
    expect(replies[1]).toContain('Opened pull request #1');
    expect(onRemote(branch)).toBe(true);
    expect(stub.github.pulls).toMatchObject([{ head: branch, base: 'main', draft: false }]);
    expect(await pullWatches(conversationId)).toEqual([{ number: 1, branch }]);
    expect(await runsOf(conversationId)).toEqual([{ id: runId, role: null, parent: null }]);
    expect(await changesOf(t, runId)).toMatchObject({
      revertible: true,
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
    expect(await keptRecords(runId)).toMatchObject([
      {
        title: KEPT_RECORD_TITLE,
        kept: { keptBy: 'full-auto', keptAt: { branch, commit: expect.any(String) } },
      },
    ]);
  });

  it('refuses a push of another branch and still publishes the chat’s own', async () => {
    const conversationId = await projectChat('full-auto');
    const main = git(repo.bare, 'rev-parse', 'main');

    const { run, runId } = await turn(conversationId, `${BUILD} #push`, {
      permission: 'do',
      agentMode: MANUAL,
      level: 'full-auto',
    });

    expect(run.status).toBe('succeeded');
    const { branch } = await worktreeOf(conversationId);
    expect(await decided(runId, 'git push origin main')).toEqual([
      { status: 'denied', reason: otherBranchReason(branch), by: 'policy' },
    ]);
    expect(git(repo.bare, 'rev-parse', 'main')).toBe(main);
    expect(onRemote(branch)).toBe(true);
    expect(stub.github.pulls).toMatchObject([{ head: branch }]);
  });

  it('plans with /plan, stops only for the agent’s plan approval, then builds in the same run', async () => {
    const conversationId = await projectChat('hands-off');

    const { run, runId, asked } = await turn(
      conversationId,
      '/plan Add CSV export #nativeplan #planbuilds',
      { permission: 'do', agentMode: MANUAL },
    );

    expect(run.status).toBe('succeeded');
    expect(asked.map((card) => [card.title, card.payload.plan])).toEqual([
      ['Approve Plan', FAKE_PLAN],
    ]);
    const { documents, lines } = await plansOf(t, conversationId);
    expect(documents).toMatchObject([{ status: 'approved', body: FAKE_PLAN, sourceRunId: runId }]);
    expect(lines).toMatchObject([{ runId, version: 1 }]);
    const changes = await changesOf(t, runId);
    expect(changes.files.map((file) => file.path)).toEqual(['export.ts']);
    expect(await keptRecords(runId)).toMatchObject([{ title: KEPT_RECORD_TITLE }]);
    expect(await runsOf(conversationId)).toHaveLength(1);
    expect(await loadOrchestration(t.db, runId)).toBeNull();
  });

  it('runs another chat’s outpost request with its label, audited, never as a publish request', async () => {
    const outpostId = await createOutpostRow(t, 'Orders launch');
    const api = await addMemberChat(t, outpostId, 'api');
    const body = 'Push it and open a pull request.';
    const postId = await deliverRequest(t.db, {
      outpostId,
      toConversationId: api,
      toHandle: 'api',
      body,
      fromUser: false,
    });

    expect(await drainQueue(t.db, api, chatTarget(t.db))).toBe('sent');
    const runId = (await postRunId(t.db, postId))!;
    const { run } = await driveToEnd(t, api, runId);

    expect(run.status).toBe('succeeded');
    const label = wrapRequest({
      postId,
      outpostName: 'Orders launch',
      author: { kind: 'other' },
      body,
    });
    const replies = await repliesOf(t, runId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain(label);
    const audit = await auditOf(t, runId);
    expect(audit.filter((entry) => entry.method === OUTPOST_REQUEST_METHOD)).toMatchObject([
      { payload: { params: { postId, fromUser: false } } },
    ]);
    expect(await promptsOf(t, runId)).toBe(1);
    expect(stub.github.pulls).toEqual([]);
  });

  it('stops mid-turn as cancelled, keeps the partial reply and publishes nothing', async () => {
    const conversationId = await projectChat('full-auto');
    const runId = await sendMessage(t, conversationId, 'Count #slow', {
      permission: 'do',
      level: 'full-auto',
    });
    await eventually(async () => (await eventTypes(t.db, runId)).includes('TEXT_MESSAGE_CONTENT'));

    await requestCancel(t.db, runId);
    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('cancelled');
    const replies = await repliesOf(t, runId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/^word0 /);
    expect(await promptsOf(t, runId)).toBe(1);
    expect(await keptRecords(runId)).toEqual([]);
    expect(stub.github.pulls).toEqual([]);
  });
});
