import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestState, type InvolvementLevel } from '@spark-outpost/contracts';
import { queueWrapUps } from '../src/outposts/story-wrap-ups.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { markStarted, saveDraft } from '../src/persistence/outpost-drafts.ts';
import { getPost, insertPosts } from '../src/persistence/outpost-posts.ts';
import { insertTasks } from '../src/persistence/outpost-stories.ts';
import { createOutpost } from '../src/persistence/outposts.ts';
import { getRun } from '../src/persistence/runs.ts';
import { publishScope, startBasis } from '../src/workflow/publish-context.ts';
import { chatTarget, drainQueue } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { linkedConversation, sendDo } from './approval-support.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';
import { postRunId } from './outpost-fixtures.ts';
import { accept, carry, chatWithTurn, newChat, reply, setRun } from './outpost-store-support.ts';
import { git, repoWithRemote, type TestRepo } from './ship-support.ts';
import { createTestDb, eventually, pinChatLevel, type TestDb } from './support.ts';

const BRANCH = 'spark/checkout-story-1a2b3c4d';

let t: TestDb;
let base: string;
let repo: TestRepo;
let harness: Worker | null = null;
let lead: string;
let api: string;
let outpostId: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-wrap-up-turn-')));
  repo = await repoWithRemote(base, 'shop');
  await connectAgents(t);
  const linked = await linkedConversation(t, repo.root);
  lead = linked.conversationId;
  git(repo.root, 'checkout', '-q', '-b', BRANCH);
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId: lead,
    projectId: linked.projectId,
    repoRoot: repo.root,
    path: repo.root,
    branch: BRANCH,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
  api = await newChat(t);
  outpostId = randomUUID();
  await createOutpost(t.db, {
    id: outpostId,
    workspaceId: t.workspaceId,
    name: 'Orders launch',
    members: [
      { conversationId: lead, handle: 'lead' },
      { conversationId: api, handle: 'api' },
    ],
  });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

async function settledStory(): Promise<string> {
  const draftId = randomUUID();
  await saveDraft(t.db, {
    id: draftId,
    workspaceId: t.workspaceId,
    conversationId: lead,
    runId: null,
    outpostId: null,
    body: {
      title: 'Checkout',
      chats: [{ handle: 'api', title: 'Orders endpoint', projectId: randomUUID(), task: 'Add.' }],
    },
  });
  await markStarted(t.db, draftId, outpostId);
  const [opening] = await insertPosts(t.db, [
    {
      id: randomUUID(),
      outpostId,
      kind: 'request',
      body: 'Build the endpoint.',
      fromUser: false,
      fromConversationId: lead,
      fromHandle: 'lead',
      toHandle: 'api',
      toConversationId: api,
      opening: true,
      userStarted: true,
    },
  ]);
  await insertTasks(t.db, [
    {
      outpostId,
      draftId,
      leadConversationId: lead,
      conversationId: api,
      title: 'Orders endpoint',
      position: 0,
      dependsOnConversationId: null,
      openingPostId: opening!.id,
    },
  ]);
  const turn = await chatWithTurn(t);
  await t.db.query('UPDATE runs SET conversation_id = $2 WHERE id = $1', [turn.runId, api]);
  await carry(t, opening!.id, turn.runId);
  await reply(t, turn.runId, 'The endpoint is in.');
  await setRun(t, turn.runId, 'succeeded');
  return draftId;
}

async function leadSettings(level: InvolvementLevel, agentMode: string): Promise<void> {
  await pinChatLevel(t.db, lead, level);
  await updateChatSettings(t.db, lead, { provider: 'claude', agentMode, level });
}

async function wrapUpRun(): Promise<string> {
  const draftId = await settledStory();
  expect(await queueWrapUps(t.db)).toBe(1);
  await accept(t, draftId);
  expect(await drainQueue(t.db, lead, chatTarget(t.db))).toBe('sent');
  return (await postRunId(t.db, draftId))!;
}

async function finished(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 60_000);
}

async function crewOf(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ role: string }>(
    'SELECT role FROM runs WHERE parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  return rows.map((row) => row.role);
}

describe('the wrap-up turn in the lead chat', { timeout: 120_000 }, () => {
  it.each([
    ['Full auto → PR', 'full-auto'],
    ['Automatic', 'hands-off'],
  ] as const)(
    'is one read-only reply at %s: no crew, no build, nothing published',
    async (_name, level) => {
      await leadSettings(level, 'acceptEdits');
      harness = startTurnWorker(t);
      const runId = await wrapUpRun();

      const run = await finished(runId);

      expect(run).toMatchObject({ status: 'succeeded', mode: 'ask', role: null });
      expect(await crewOf(runId)).toEqual([]);
      expect(await loadOrchestration(t.db, runId)).toBeNull();
      const detail = (await getConversationDetail(t.db, lead))!;
      const replies = detail.messages.filter((message) => message.role === 'assistant');
      expect(replies).toHaveLength(1);
      expect(replies[0]!.content.length).toBeGreaterThan(0);
      expect(git(repo.bare, 'branch', '--list')).not.toContain(BRANCH);
      const post = (await getPost(t.db, run.outpost!.postId))!;
      expect(requestState(post.facts!).state).toBe('answered');
    },
  );

  it.each([
    ['Full auto → PR in Accept edits', 'full-auto', 'acceptEdits'],
    ['Automatic in Bypass permissions', 'hands-off', 'bypassPermissions'],
  ] as const)('carries no basis to publish at %s', async (_name, level, agentMode) => {
    await leadSettings(level, agentMode);
    const typed = await loadRunInput(t.db, await sendDo(t, lead, 'tidy the notes', level));
    await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
      typed.identity.runId,
    ]);
    const wrapUp = await loadRunInput(t.db, await wrapUpRun());

    expect(wrapUp.outpostRequest).toMatchObject({ wrapUp: true, fromUser: false });
    expect(startBasis({ ...typed, agentMode })).not.toBeNull();
    expect(await publishScope(t.db, { ...typed, agentMode })).not.toBeNull();
    expect(startBasis(wrapUp)).toBeNull();
    expect(await publishScope(t.db, wrapUp)).toBeNull();
  });
});
