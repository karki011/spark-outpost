import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ghRailReason } from '../src/approvals/publish-policy.ts';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { decideApproval, getApproval } from '../src/persistence/approvals.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { watchPullRequest } from '../src/persistence/pr-watches.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { taskBranch } from '../src/workflow/publish-context.ts';
import { commandRequest, doRun, recordingAppend } from './approval-support.ts';
import { repoWithRemote } from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const BRANCH = 'spark/review-notes-1a2b3c4d';
const GREPTILE_COMMENT = `gh pr view 2233 --json comments,reviews -q '[.comments[] | select(.author.login=="greptile-apps") | {updated: .updatedAt, body: (.body | gsub("<[^>]*>"; "") | .[0:1500])}] | last' 2>&1 | head -40`;
const SCORE_LINES = `gh pr view 2233 --comments > /tmp/pr2233-comments.txt 2>&1; rg -n "Confidence Score|P1|P2|P3" /tmp/pr2233-comments.txt | sed 's/<[^>]*>//g' | cut -c1-220 | tail -15`;
const READS = [GREPTILE_COMMENT, SCORE_LINES, 'gh pr checks 2233', 'gh run view 1 --log-failed'];
const NON_ASKING = [
  ['claude', 'auto'],
  ['claude', 'bypassPermissions'],
  ['codex', 'agent-full-access'],
] as const;

let t: TestDb;
let base: string;
let root: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-gh-reads-')));
  ({ root } = await repoWithRemote(base, 'widgets'));
  execFileSync('git', ['-C', root, 'checkout', '-q', '-b', BRANCH]);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

type Chat = Awaited<ReturnType<typeof doRun>>;

async function ownChat(pull: number | null): Promise<Chat> {
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
  if (pull === null) return chat;
  const taskId = randomUUID();
  await t.db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
    taskId,
    chat.conversationId,
    'Review notes',
  ]);
  await watchPullRequest(t.db, {
    workspaceId: t.workspaceId,
    conversationId: chat.conversationId,
    taskId,
    host: 'github.com',
    owner: 'acme',
    repo: 'widgets',
    number: pull,
    url: `https://github.com/acme/widgets/pull/${pull}`,
    branch: BRANCH,
  });
  return chat;
}

function chatGate(chat: Chat, provider: string, mode: string) {
  const waiters = new ApprovalWaiters();
  const observations = createRunObservations({
    db: t.db,
    ...chat,
    audit: { message: () => undefined, stderr: () => undefined },
  });
  const gate = createApprovalGate({
    db: t.db,
    runId: chat.runId,
    provider,
    mode,
    changesProject: true,
    append: recordingAppend().append,
    waiters,
    pollMs: 20,
    onTimeout: () => undefined,
    backup: async () => undefined,
    observations,
    publish: { level: 'hands-off', requested: false },
  });
  return { gate, waiters };
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

const signal = () => new AbortController().signal;

describe.each([null, 2233, 77])(
  "the chat run reading pull requests through gh when the chat's recorded pull request is %s",
  (pull) => {
    it.each(NON_ASKING)('runs every read without a card in %s %s', async (provider, mode) => {
      const chat = await ownChat(pull);
      expect((await taskBranch(t.db, root))?.pull ?? null).toBe(pull);
      const { gate } = chatGate(chat, provider, mode);
      for (const command of READS) {
        const answer = await gate.review(commandRequest(root, command, randomUUID()), signal());
        expect(answer, command).toMatchObject({ allowed: true });
      }
    });

    it("shows the mode's ordinary card in Manual", async () => {
      const chat = await ownChat(pull);
      const { gate, waiters } = chatGate(chat, 'claude', 'default');
      for (const command of [GREPTILE_COMMENT, SCORE_LINES]) {
        const waiting = gate.review(commandRequest(root, command, randomUUID()), signal());
        const card = await pendingCard(chat.runId);
        expect(card.reason, command).toBeNull();
        await decideApproval(t.db, t.workspaceId, card.id, { optionId: 'allow', scope: 'once' });
        waiters.notify(card.id);
        expect(await waiting).toMatchObject({ allowed: true });
      }
    });

    it('still refuses a write on a pull request that is not its own', async () => {
      const chat = await ownChat(pull);
      const { gate } = chatGate(chat, 'claude', 'bypassPermissions');
      const refused = [
        ['gh pr merge 2233', 'gh pr merge'],
        ['gh pr edit 5 --title x', 'gh pr edit'],
        ['gh api -X POST repos/acme/widgets/pulls/2233/comments -f body=x', 'gh api'],
      ] as const;
      for (const [command, named] of refused) {
        const answer = await gate.review(commandRequest(root, command, randomUUID()), signal());
        expect(answer, command).toMatchObject({ allowed: false });
        expect(JSON.stringify(answer), command).toContain(ghRailReason(named));
      }
    });
  },
);
