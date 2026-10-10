import { runChatTurn } from '../src/workflow/chat-turn.ts';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_PUBLISH_REASON } from '../src/approvals/decide.ts';
import { agentEnvironment } from '../src/agents/acp/agent-env.ts';
import { PUBLISH_ASK_RULES, agentDefinitions } from '../src/agents/acp/agents.ts';
import { otherBranchReason } from '../src/approvals/publish-policy.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { commandRequest, linkedConversation, recordingAppend } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { driveToEnd, gitRepo, removeRepo, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BRANCH = 'spark/notes-1a2b3c4d';
const MANUAL = 'default';

let t: TestDb;
let root: string;
let remote: string;
let conversationId: string;
let worker: Worker;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  remote = await realpath(await mkdtemp(join(tmpdir(), 'spark-chat-run-remote-')));
  git(remote, 'init', '-q', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'checkout', '-qb', BRANCH);
  await connectAgents(t);
  const linked = await linkedConversation(t, root);
  conversationId = linked.conversationId;
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId,
    projectId: linked.projectId,
    repoRoot: root,
    path: root,
    branch: BRANCH,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
  worker = startTurnWorker(t, { runTurn: runChatTurn, agentEnv: { GH_TOKEN: 'ghp_test' } });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
  await rm(remote, { recursive: true, force: true });
});

async function turn(text: string, level: InvolvementLevel = 'hands-off'): Promise<string> {
  const runId = await sendMessage(t, conversationId, text, {
    permission: 'do',
    agentMode: MANUAL,
    level,
  });
  const { run } = await driveToEnd(t, conversationId, runId);
  expect(run.status).toBe('succeeded');
  return runId;
}

async function decided(runId: string, command: string) {
  const { rows } = await t.db.query<{ status: string; reason: string | null; by: string | null }>(
    `SELECT status, reason, decided_by AS by FROM approvals
     WHERE run_id = $1 AND payload->>'command' = $2`,
    [runId, command],
  );
  return rows;
}

const remoteBranches = () => git(remote, 'branch', '--format=%(refname:short)').trim();

describe("the chat's own changing run through the turn seam", () => {
  it('is refused a push when nothing gives it a reason to publish', async () => {
    const runId = await turn('Tidy the notes #build #push');

    expect(await decided(runId, 'git push origin main')).toEqual([
      { status: 'denied', reason: CHAT_PUBLISH_REASON, by: 'policy' },
    ]);
    expect(remoteBranches()).toBe('');
  });

  it('is refused a push of another branch at Full auto → PR', async () => {
    const runId = await turn('Tidy the notes #build #push', 'full-auto');

    expect(await decided(runId, 'git push origin main')).toEqual([
      { status: 'denied', reason: otherBranchReason(BRANCH), by: 'policy' },
    ]);
    expect(remoteBranches().split('\n')).not.toContain('main');
  });

  it('pushes its own branch without a card when the message asks for it', async () => {
    const asked = `## Publish this change\n\`git push origin ${BRANCH}\` #nopr`;
    const runId = await turn(asked);

    expect(await decided(runId, `git push origin ${BRANCH}`)).toEqual([
      { status: 'allowed', reason: null, by: 'level' },
    ]);
    expect(await repliesOf(t, runId)).toEqual(['published=pushed']);
    expect(remoteBranches()).toBe(BRANCH);
  });

  it('starts Claude with git push and gh sent to the gate and gh not denied', async () => {
    const [shown] = await repliesOf(t, await turn('Show it #session'));
    const { permissions } = (
      JSON.parse(shown!.replace(/^session=/, '')) as {
        meta: { claudeCode: { options: { settings: { permissions: Permissions } } } };
      }
    ).meta.claudeCode.options.settings;
    expect(permissions.ask).toEqual([...PUBLISH_ASK_RULES]);
    expect(permissions.deny).not.toContain('Bash(gh:*)');
    expect(permissions.deny).toContain('Bash(git remote add:*)');
  });

  it('keeps the gh sign-in of a run that may not publish, so reads through gh work', async () => {
    const [names] = await repliesOf(t, await turn('Show it #env'));
    expect((JSON.parse(names!) as { names: string[] }).names).toContain('GH_TOKEN');
  });
});

interface Permissions {
  ask?: string[];
  deny: string[];
}

describe("the agent process of the chat's own changing run that may not publish", () => {
  it('can fetch from the remote and cannot push to it', async () => {
    await worker.stop();
    git(root, 'push', '-q', 'origin', BRANCH);
    const env = await agentEnvironment(
      { definition: agentDefinitions.claude, env: process.env as Record<string, string> },
      root,
      false,
      null,
      false,
      {},
      true,
    );
    const guarded = (...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: 'pipe' });

    expect(() => guarded('fetch', 'origin')).not.toThrow();
    expect(git(root, 'branch', '-r', '--format=%(refname:short)').trim()).toBe(`origin/${BRANCH}`);
    expect(() => guarded('push', 'origin', BRANCH)).toThrow(/spark-outpost-no-push/);
  });
});

describe("the approval gate of the chat's own changing run", () => {
  async function gate() {
    const runId = await sendMessage(t, conversationId, 'work', {
      permission: 'do',
      agentMode: MANUAL,
    });
    await worker.stop();
    return {
      runId,
      gate: createApprovalGate({
        db: t.db,
        runId,
        provider: 'claude',
        mode: MANUAL,
        chatRun: true,
        publish: { level: 'hands-off', requested: false },
        append: recordingAppend().append,
        waiters: new ApprovalWaiters(),
        pollMs: 20,
        onTimeout: () => undefined,
        backup: async () => undefined,
      }),
    };
  }

  async function statuses(runId: string) {
    const { rows } = await t.db.query<{ status: string; reason: string | null }>(
      'SELECT status, reason FROM approvals WHERE run_id = $1 ORDER BY created_at',
      [runId],
    );
    return rows.map((row) => [row.status, row.reason]);
  }

  it.each(['gh pr view 12 --json state', 'gh pr checks 77', 'git fetch origin'])(
    'does not refuse the read %s when the run may not publish',
    async (command) => {
      const { runId, gate: reads } = await gate();
      const stop = new AbortController();
      const answer = reads.review(commandRequest(root, command), stop.signal);
      const [status] = await eventually(async () => {
        const seen = await statuses(runId);
        return seen.length > 0 ? seen[0]! : null;
      });
      expect(['allowed', 'pending']).toContain(status);
      stop.abort();
      await answer;
    },
  );

  it.each(['gh pr merge 12 --squash', `gh pr create --head ${BRANCH} --fill`, 'git push'])(
    'refuses the write %s when the run may not publish',
    async (command) => {
      const { runId, gate: writes } = await gate();
      const answer = await writes.review(
        commandRequest(root, command),
        new AbortController().signal,
      );
      expect(answer).toMatchObject({ outcome: 'selected', allowed: false });
      expect(await statuses(runId)).toEqual([['denied', CHAT_PUBLISH_REASON]]);
    },
  );
});
