import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decide,
  NO_RUN_RULES,
  PUBLISH_FOLLOW_UP_WHY,
  type ApprovalRequest,
} from '../src/approvals/decide.ts';
import type { FileLister } from '../src/approvals/file-lister.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { watchPullRequest } from '../src/persistence/pr-watches.ts';
import { publishContext, publishGrant, publishScope } from '../src/workflow/publish-context.ts';
import { linkedConversation } from './approval-support.ts';
import { repoWithRemote } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const BRANCH = 'spark/notes-1a2b3c4d';

let t: TestDb;
let base: string;
let root: string;
let conversationId: string;
let taskId: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-publish-follow-up-')));
  ({ root } = await repoWithRemote(base, 'widgets'));
  const linked = await linkedConversation(t, root);
  conversationId = linked.conversationId;
  taskId = randomUUID();
  await t.db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
    taskId,
    conversationId,
    'Tidy the notes',
  ]);
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
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

async function watch(branch: string, number = 7) {
  await watchPullRequest(t.db, {
    workspaceId: t.workspaceId,
    conversationId,
    taskId,
    host: 'github.com',
    owner: 'acme',
    repo: 'widgets',
    number,
    url: `https://github.com/acme/widgets/pull/${number}`,
    branch,
  });
}

const round = (followUpRound = true) => ({
  level: 'hands-off' as const,
  userRequest: 'PR follow-up, round 1: acme/widgets#7',
  followUpRound,
  workspaceId: t.workspaceId,
  identity: { threadId: conversationId },
  provider: 'claude',
  agentMode: 'default',
  piece: null,
  projectRoots: [root],
});

const files: FileLister = { glob: () => [], walk: () => [], script: () => null };

function request(command: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
    cwd: root,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: root, ignore: [] }],
    home: '/Users/me',
  };
}

async function verdict(command: string, followUpRound = true) {
  const asked = request(command);
  const context = await publishContext(t.db, publishGrant(round(followUpRound)), asked);
  return decide('asks', asked, NO_RUN_RULES, [], { builder: true, files, ...context });
}

describe('pushing a follow-up fix at Automatic in an asking mode', () => {
  it("is authorized for the chat's own branch while its pull request is open", async () => {
    await watch(BRANCH);
    expect(await publishScope(t.db, round())).toMatchObject({
      basis: 'follow_up',
      task: { branch: BRANCH },
    });
    expect(await verdict(`git push origin ${BRANCH}`)).toMatchObject({
      verdict: 'allow',
      why: PUBLISH_FOLLOW_UP_WHY,
    });
  });

  it('is refused for any other branch, a force push or skipped hooks', async () => {
    await watch(BRANCH);
    for (const command of [
      'git push origin spark/someone-else',
      'git push origin main',
      `git push --force origin ${BRANCH}`,
      `git push --no-verify origin ${BRANCH}`,
      'gh pr merge',
    ]) {
      expect((await verdict(command)).verdict, command).toBe('reject');
    }
  });

  it('is not authorized when the chat opened no pull request on this branch', async () => {
    expect(await publishScope(t.db, round())).toBeNull();
    await watch('spark/another-chat-9z8y7x6w', 8);
    expect(await publishScope(t.db, round())).toBeNull();
    expect((await verdict(`git push origin ${BRANCH}`)).verdict).not.toBe('allow');
  });

  it('ends when the pull request is merged or closed', async () => {
    await watch(BRANCH);
    await t.db.query("UPDATE pr_watches SET pr_state = 'merged', phase = 'done'");
    expect(await publishScope(t.db, round())).toBeNull();
    expect((await verdict(`git push origin ${BRANCH}`)).verdict).not.toBe('allow');
  });

  it('is not carried by an ordinary turn in the same chat', async () => {
    await watch(BRANCH);
    expect(await publishScope(t.db, round(false))).toBeNull();
    expect((await verdict(`git push origin ${BRANCH}`, false)).verdict).not.toBe('allow');
  });
});
