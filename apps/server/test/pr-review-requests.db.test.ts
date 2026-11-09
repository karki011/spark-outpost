import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decide, NO_RUN_RULES, type ApprovalRequest } from '../src/approvals/decide.ts';
import { REREQUEST_REVIEW_WHY } from '../src/approvals/decide-publish.ts';
import type { FileLister } from '../src/approvals/file-lister.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { watchPullRequest } from '../src/persistence/pr-watches.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { publishContext, publishGrant } from '../src/workflow/publish-context.ts';
import { ownRepoFor } from '../src/workflow/send-context.ts';
import { linkedConversation, sendDo } from './approval-support.ts';
import { git, repoWithRemote } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const BRANCH = 'spark/notes-1a2b3c4d';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };

let t: TestDb;
let base: string;
let root: string;
let conversationId: string;
let runId: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-review-requests-')));
  ({ root } = await repoWithRemote(base, 'widgets'));
  git(root, 'switch', '-q', '-c', BRANCH);
  git(root, 'remote', 'set-url', 'origin', 'https://github.com/acme/widgets.git');
  const linked = await linkedConversation(t, root);
  conversationId = linked.conversationId;
  const taskId = randomUUID();
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
  await watchPullRequest(t.db, {
    workspaceId: t.workspaceId,
    conversationId,
    taskId,
    host: 'github.com',
    owner: 'acme',
    repo: 'widgets',
    number: 7,
    url: 'https://github.com/acme/widgets/pull/7',
    branch: BRANCH,
  });
  await t.db.query(
    "UPDATE pr_watches SET known_reviewers = '{alice,coderabbitai[bot]}' WHERE conversation_id = $1",
    [conversationId],
  );
  runId = await sendDo(t, conversationId, 'PR follow-up, round 1: acme/widgets#7');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

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
  const grant = publishGrant({
    level: 'hands-off',
    userRequest: 'PR follow-up, round 1: acme/widgets#7',
    followUpRound,
    workspaceId: t.workspaceId,
    identity: { threadId: conversationId },
  });
  const context = await publishContext(t.db, grant, asked);
  const own = await ownRepoFor(t.db, runId, asked);
  return decide('asks', asked, NO_RUN_RULES, [], { changesProject: true, files, own, ...context });
}

describe('re-requesting review on the chat’s own pull request', () => {
  it('reads the reviewers already on the followed pull request', async () => {
    const own = await ownRepoFor(t.db, runId, request('gh pr edit 7 --add-reviewer alice'));
    expect(own).toMatchObject({
      slug: 'acme/widgets',
      branch: BRANCH,
      pull: 7,
      reviewers: ['alice', 'coderabbitai[bot]'],
    });
  });

  it('allows an existing reviewer in a follow-up round, with its own audited reason', async () => {
    expect(await verdict('gh pr edit 7 --add-reviewer alice,coderabbitai[bot]')).toEqual({
      verdict: 'allow',
      by: 'level',
      why: REREQUEST_REVIEW_WHY,
    });
  });

  it('refuses a new reviewer, another pull request, and any re-request outside a round', async () => {
    expect((await verdict('gh pr edit 7 --add-reviewer mallory')).verdict).toBe('reject');
    expect((await verdict('gh pr edit 8 --add-reviewer alice')).verdict).toBe('reject');
    expect((await verdict('gh pr edit 7 --add-reviewer alice', false)).verdict).toBe('reject');
  });

  it('refuses it once follow-up is off or asks first', async () => {
    await updateProfile(t.db, t.workspaceId, { prFollowUpAsk: true });
    expect((await verdict('gh pr edit 7 --add-reviewer alice')).verdict).toBe('reject');
    await updateProfile(t.db, t.workspaceId, { prFollowUpAsk: false, prFollowUp: false });
    expect((await verdict('gh pr edit 7 --add-reviewer alice')).verdict).toBe('reject');
  });
});
