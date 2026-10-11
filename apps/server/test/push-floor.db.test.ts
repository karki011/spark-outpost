import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_PUBLISH_REASON } from '../src/approvals/decide.ts';
import { PLAIN_FORCE_REASON } from '../src/approvals/git-commands.ts';
import {
  NO_TASK_BRANCH_REASON,
  REMOTE_RAIL_REASON,
  ghRailReason,
  otherBranchReason,
  type PublishGrant,
} from '../src/approvals/publish-policy.ts';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { watchedSends } from '../src/observations/send-watch.ts';
import { getApproval } from '../src/persistence/approvals.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { listRailFlags } from '../src/persistence/rail-flags.ts';
import type { ProtocolObserver } from '../src/providers/provider.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { startRailFlags } from '../src/workflow/rail-flags.ts';
import { commandRequest, doRun, recordingAppend, type LinkedRun } from './approval-support.ts';
import { repoWithRemote } from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const BRANCH = 'spark/push-floor-1a2b3c4d';
const NOT_ASKED: PublishGrant = { level: 'hands-off', requested: false };
const ASKED: PublishGrant = { level: 'hands-off', requested: true };
const GATE_SEES = [
  ['claude', 'default'],
  ['claude', 'acceptEdits'],
  ['claude', 'auto'],
  ['claude', 'bypassPermissions'],
  ['codex', 'ask-every-action'],
  ['codex', 'agent'],
] as const;

let t: TestDb;
let base: string;
let root: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-push-floor-')));
  ({ root } = await repoWithRemote(base, 'widgets'));
  execFileSync('git', ['-C', root, 'checkout', '-q', '-b', BRANCH]);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

async function chatOnOwnBranch(): Promise<LinkedRun> {
  const chat = await doRun(t, root, 'work', 'hands-off');
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId: chat.conversationId,
    projectId: chat.projectId,
    repoRoot: root,
    path: root,
    branch: BRANCH,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
  return chat;
}

function auditLog() {
  const methods: string[] = [];
  const audit: ProtocolObserver = {
    message: (_direction, message) => {
      const method = (message as { method?: string }).method;
      if (method) methods.push(method);
    },
    stderr: () => undefined,
  };
  return { methods, audit };
}

function mainAgentGate(chat: LinkedRun, provider: string, mode: string, publish: PublishGrant) {
  return createApprovalGate({
    db: t.db,
    runId: chat.runId,
    provider,
    mode,
    changesProject: true,
    append: recordingAppend().append,
    waiters: new ApprovalWaiters(),
    pollMs: 20,
    onTimeout: () => undefined,
    backup: async () => undefined,
    publish,
  });
}

const signal = () => new AbortController().signal;

async function policyDenials(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ reason: string }>(
    `SELECT reason FROM approvals
     WHERE run_id = $1 AND status = 'denied' AND decided_by = 'policy' ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => row.reason);
}

async function pendingCard(runId: string) {
  const id = await eventually(async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows[0]?.id ?? null;
  });
  return (await getApproval(t.db, id))!;
}

describe("the chat's own agent at the approval gate", () => {
  it.each(GATE_SEES)(
    'is refused the push rails in %s %s, with or without a request to publish',
    async (provider, mode) => {
      const chat = await chatOnOwnBranch();
      const rails = [
        ['git push origin main', otherBranchReason(BRANCH)],
        ['git push origin some-other-branch', otherBranchReason(BRANCH)],
        [`git push --force origin ${BRANCH}`, PLAIN_FORCE_REASON],
        ['git remote add fork https://example.net/fork.git', REMOTE_RAIL_REASON],
        ['git remote set-url origin https://example.net/other.git', REMOTE_RAIL_REASON],
        ['gh pr create --head some-other-branch --fill', ghRailReason('gh pr create')],
      ] as const;
      const asked = mainAgentGate(chat, provider, mode, ASKED);
      for (const [command] of rails) {
        const answer = await asked.review(commandRequest(root, command, randomUUID()), signal());
        expect(answer, command).toMatchObject({ outcome: 'selected', allowed: false });
      }
      expect(await policyDenials(chat.runId)).toEqual(rails.map(([, reason]) => reason));
      const unasked = mainAgentGate(chat, provider, mode, NOT_ASKED);
      for (const [command] of rails) {
        const answer = await unasked.review(commandRequest(root, command, randomUUID()), signal());
        expect(answer, command).toMatchObject({ outcome: 'selected', allowed: false });
      }
      expect(await policyDenials(chat.runId)).toHaveLength(rails.length * 2);
    },
  );

  it('is refused any push when the chat has no branch of its own', async () => {
    const chat = await doRun(t, root, 'work', 'hands-off');
    const gate = mainAgentGate(chat, 'claude', 'auto', ASKED);
    const answer = await gate.review(commandRequest(root, 'git push origin main'), signal());
    expect(answer).toMatchObject({ allowed: false });
    expect(await policyDenials(chat.runId)).toEqual([NO_TASK_BRANCH_REASON]);
  });

  it('publishes its own branch when the message asked, and not otherwise in Manual', async () => {
    const chat = await chatOnOwnBranch();
    const push = `git push origin ${BRANCH}`;
    const asked = mainAgentGate(chat, 'claude', 'default', ASKED);
    expect(await asked.review(commandRequest(root, push, 'p1'), signal())).toMatchObject({
      allowed: true,
    });
    const unasked = mainAgentGate(chat, 'claude', 'default', NOT_ASKED);
    expect(await unasked.review(commandRequest(root, push, 'p2'), signal())).toMatchObject({
      allowed: false,
    });
    expect(await policyDenials(chat.runId)).toEqual([CHAT_PUBLISH_REASON]);
    const auto = mainAgentGate(chat, 'claude', 'auto', NOT_ASKED);
    expect(await auto.review(commandRequest(root, push, 'p3'), signal())).toMatchObject({
      allowed: true,
    });
  });

  it.each(['gh pr view 12', 'gh pr checks', 'git fetch origin', 'git fetch origin main'])(
    'reads with %s as the mode allows, never refused',
    async (command) => {
      const chat = await chatOnOwnBranch();
      for (const [provider, mode] of [
        ['claude', 'auto'],
        ['claude', 'bypassPermissions'],
        ['codex', 'agent'],
      ] as const) {
        const gate = mainAgentGate(chat, provider, mode, NOT_ASKED);
        const answer = await gate.review(commandRequest(root, command, randomUUID()), signal());
        expect(answer, `${provider} ${mode}`).toMatchObject({ allowed: true });
      }
      const manual = mainAgentGate(chat, 'claude', 'default', NOT_ASKED);
      const controller = new AbortController();
      const waiting = manual.review(commandRequest(root, command, 'manual'), controller.signal);
      expect((await pendingCard(chat.runId)).reason).toBeNull();
      controller.abort();
      await waiting;
      expect(await policyDenials(chat.runId)).toEqual([]);
    },
  );
});

function watchFor(chat: LinkedRun) {
  const { methods, audit } = auditLog();
  const observations = createRunObservations({ db: t.db, ...chat, audit });
  const observer = watchedSends(audit, {
    db: t.db,
    runId: chat.runId,
    mode: 'do',
    projectRoots: [root],
    observations,
  });
  const update = (fields: Record<string, unknown>) =>
    observer.message('from_agent', { method: 'session/update', params: { update: fields } });
  const command = (toolCallId: string, text: string) => {
    const tool = { toolCallId, kind: 'execute', title: text, rawInput: { command: text } };
    update({ sessionUpdate: 'tool_call', status: 'pending', ...tool });
    update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
  };
  const asked = (toolCallId: string) =>
    observer.message('from_agent', {
      id: 7,
      method: 'session/request_permission',
      params: { toolCall: { toolCallId } },
    });
  const flags = async () => {
    await observations.settled();
    return listRailFlags(t.db, chat.conversationId);
  };
  return { command, asked, flags, methods };
}

describe('a push the approval gate never saw', () => {
  it('is flagged when it names a branch that is not the chat’s own, without stopping anything', async () => {
    const chat = await chatOnOwnBranch();
    const watch = watchFor(chat);
    watch.command('c1', 'git push origin main');
    watch.command('c2', `git push origin ${BRANCH} some-other-branch 2>&1 | tail -3`);
    watch.command('c3', 'sh -c "git push origin main"');
    const flags = await watch.flags();
    expect(flags.map((flag) => flag.title)).toEqual([
      "Fake provider pushed a branch that isn't this chat's own: main",
      "Fake provider pushed a branch that isn't this chat's own: some-other-branch",
    ]);
    expect(flags[0]).toMatchObject({
      rail: 'other_push',
      paths: ['main'],
      inside: false,
      originals: [],
      status: 'open',
    });
    expect(watch.methods.filter((method) => method === 'spark/rail_crossed')).toHaveLength(2);
  });

  it("leaves the chat's own branch, reads and requests the gate answered alone", async () => {
    const chat = await chatOnOwnBranch();
    const watch = watchFor(chat);
    watch.command('own', `git push -u origin ${BRANCH}`);
    watch.command('head', 'git push origin HEAD');
    watch.command('bare', 'git push');
    watch.command('fetch', 'git fetch origin main');
    watch.command('view', 'gh pr view 12');
    watch.asked('gated');
    watch.command('gated', 'git push origin main');
    expect(await watch.flags()).toEqual([]);
  });

  it('is flagged whatever it names when the chat has no branch of its own', async () => {
    const chat = await doRun(t, root, 'work', 'hands-off');
    const watch = watchFor(chat);
    watch.command('c1', 'git push');
    expect((await watch.flags()).map((flag) => flag.title)).toEqual([
      "Fake provider pushed a branch that isn't this chat's own",
    ]);
  });
});

describe('a remote change the approval gate never saw', () => {
  it('is flagged when the run ends, with the original config to restore', async () => {
    const chat = await chatOnOwnBranch();
    const { methods, audit } = auditLog();
    const rails = await startRailFlags({
      db: t.db,
      runId: chat.runId,
      projectRoots: [root],
      audit,
    });
    execFileSync('git', ['-C', root, 'remote', 'add', 'fork', 'https://example.net/fork.git']);
    await rails.finish();
    const flags = await listRailFlags(t.db, chat.conversationId);
    expect(flags).toEqual([
      expect.objectContaining({
        rail: 'git_control',
        paths: ['.git/config'],
        title: 'Fake provider changed git hooks or config: .git/config',
        status: 'open',
      }),
    ]);
    expect(flags[0]!.originals[0]!.text).not.toContain('example.net');
    expect(methods).toEqual(['spark/rail_crossed']);
  });
});
