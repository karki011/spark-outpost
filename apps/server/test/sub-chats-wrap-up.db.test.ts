import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { sendRule, targetChat, turnStart } from '../src/sub-chats/asks.ts';
import { subChatNeeds } from '../src/sub-chats/availability.ts';
import { deliveryPass } from '../src/sub-chats/delivery.ts';
import { publishScope, startBasis } from '../src/workflow/publish-context.ts';
import { chatTarget, drainQueue } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { linkedConversation, sendDo } from './approval-support.ts';
import { fakeTarget, finishTurn, turnsOf } from './chat-ask-fixtures.ts';
import { git, repoWithRemote, type TestRepo } from './ship-support.ts';
import { addSubChat } from './sub-chat-fixtures.ts';
import { asksOf, endTask, startTask, type StartedTask } from './sub-chat-report-fixtures.ts';
import { createTestDb, eventually, pinChatLevel, type TestDb } from './support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BRANCH = 'spark/checkout-rework-1a2b3c4d';

let t: TestDb;
let base: string;
let repo: TestRepo;
let harness: Worker | null = null;
let parent: string;
let api: StartedTask;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-sub-chat-wrap-up-')));
  repo = await repoWithRemote(base, 'shop');
  await connectAgents(t);
  const linked = await linkedConversation(t, repo.root);
  parent = linked.conversationId;
  git(repo.root, 'checkout', '-q', '-b', BRANCH);
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId: parent,
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
  api = await startTask(t, await addSubChat(t, parent, 'Orders API'));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

const pass = () => deliveryPass(t.db, fakeTarget);

async function parentSettings(level: InvolvementLevel, agentMode: string): Promise<void> {
  await pinChatLevel(t.db, parent, level);
  await updateChatSettings(t.db, parent, { provider: 'claude', agentMode, level });
}

async function endParentTurns(): Promise<void> {
  for (const turn of await turnsOf(t, parent)) {
    if (turn.status !== 'succeeded') await finishTurn(t, turn.id, 'succeeded', 'Noted.');
  }
}

async function wrapUps() {
  return asksOf(t, parent, 'wrap_up');
}

async function wrapUpRun(): Promise<string> {
  await endTask(t, api);
  await pass();
  await endParentTurns();
  expect(await drainQueue(t.db, parent, chatTarget(t.db))).toBe('sent');
  const [wrapUp] = await wrapUps();
  const turn = (await turnsOf(t, parent)).find((each) => each.user_message_id === wrapUp!.id);
  return turn!.id;
}

describe('the wrap-up Spark sends a parent', () => {
  it('is written once, after every sub-chat has reported', async () => {
    const page = await startTask(t, await addSubChat(t, parent, 'Orders page'));
    await endTask(t, api);
    await pass();
    expect(await wrapUps()).toEqual([]);

    await endTask(t, page, 'failed', '');
    await pass();
    await pass();

    const [wrapUp, ...more] = await wrapUps();
    expect(more).toEqual([]);
    expect(wrapUp).toMatchObject({ from: { id: null, title: 'Spark' }, state: null });
    expect(wrapUp!.body).toContain('“Orders API”: Done · no branch');
    expect(wrapUp!.body).toContain('“Orders page”: Needs you (Its last turn failed.)');
    expect(wrapUp!.body).toContain('the user did not write it');
  });

  it('counts a sub-chat Held behind a failure as settled and says why it is Held', async () => {
    await addSubChat(t, parent, 'Orders page', { stackedOn: api.id });
    await endTask(t, api, 'cancelled', '');

    await pass();

    const [wrapUp] = await wrapUps();
    expect(wrapUp!.body).toContain(
      '“Orders page”: Held (Held: “Orders API” did not finish. Start anyway starts it.) · stacked on “Orders API”',
    );
    expect(wrapUp!.body).toContain(
      'Merge the stacked pull requests in this order: “Orders API”, then “Orders page”.',
    );
  });

  it('waits while a Held sub-chat can still start by itself', async () => {
    await addSubChat(t, parent, 'Orders page', { startsAfter: [api.id] });
    await endTask(t, api);
    const paused = `UPDATE profiles SET spark_paused_at = now() WHERE workspace_id = $1`;
    await t.db.query(
      `INSERT INTO profiles (workspace_id, spark_paused_at) VALUES ($1, now())
       ON CONFLICT (workspace_id) DO NOTHING`,
      [t.workspaceId],
    );
    await t.db.query(paused, [t.workspaceId]);

    await pass();

    expect(await wrapUps()).toEqual([]);
  });

  it('is written once more after sub-chats are added later', async () => {
    await endTask(t, api);
    await pass();
    expect(await wrapUps()).toHaveLength(1);
    await endParentTurns();

    const docs = await startTask(t, await addSubChat(t, parent, 'Docs'));
    await pass();
    expect(await wrapUps()).toHaveLength(1);
    await endTask(t, docs);
    await pass();
    await pass();

    const all = await wrapUps();
    expect(all).toHaveLength(2);
    expect(all[1]!.body).toContain('“Orders API”');
    expect(all[1]!.body).toContain('“Docs”');
  });

  it('starts its own turn after the report, never steered into a running one', async () => {
    await endTask(t, api);
    await pass();

    const [report] = await asksOf(t, parent, 'report');
    const [wrapUp] = await wrapUps();
    expect((await turnsOf(t, parent)).map((turn) => turn.user_message_id)).toEqual([report!.id]);
    const { rows } = await t.db.query('SELECT 1 FROM member_messages WHERE id = $1', [wrapUp!.id]);
    expect(rows).toEqual([]);

    await endParentTurns();
    expect(await drainQueue(t.db, parent, fakeTarget)).toBe('sent');
    await pass();

    const turns = await turnsOf(t, parent);
    expect(turns.map((turn) => turn.user_message_id)).toEqual([report!.id, wrapUp!.id]);
  });

  it('may message no chat and start or stop no sub-chat in its turn', async () => {
    const runId = await wrapUpRun();

    expect(await turnStart(t.db, runId)).toMatchObject({ kind: 'wrap_up', fromOwnSubChat: false });
    const rule = sendRule({
      fromChatId: parent,
      to: await targetChat(t.db, t.workspaceId, parent, api.id),
      startedBy: await turnStart(t.db, runId),
      userAsked: true,
    });
    expect(rule.kind).toBe('refuse');
    expect(await subChatNeeds(t.db, { conversationId: parent, runId })).toEqual({
      sub_chats: false,
      sub_chat_stop: false,
    });
  });
});

describe('the wrap-up turn in the parent', { timeout: 120_000 }, () => {
  it.each([
    ['Full auto → PR', 'full-auto', 'acceptEdits'],
    ['Automatic in Auto', 'hands-off', 'auto'],
  ] as const)(
    'is one read-only reply at %s: no crew, no build, nothing published',
    async (_name, level, agentMode) => {
      await parentSettings(level, agentMode);
      const runId = await wrapUpRun();
      harness = startTurnWorker(t);

      const run = await eventually(async () => {
        const found = await getRun(t.db, runId);
        return found?.finishedAt ? found : null;
      }, 60_000);

      expect(run).toMatchObject({ status: 'succeeded', mode: 'ask', role: null });
      const crew = await t.db.query('SELECT 1 FROM runs WHERE parent_run_id = $1', [runId]);
      expect(crew.rows).toEqual([]);
      expect(await loadOrchestration(t.db, runId)).toBeNull();
      const detail = (await getConversationDetail(t.db, parent))!;
      const reply = detail.messages.find((message) => message.runId === runId);
      expect(reply?.content.length).toBeGreaterThan(0);
      expect(git(repo.bare, 'branch', '--list')).not.toContain(BRANCH);
    },
  );

  it.each([
    ['Full auto → PR in Accept edits', 'full-auto', 'acceptEdits'],
    ['Automatic in Bypass permissions', 'hands-off', 'bypassPermissions'],
  ] as const)('carries no basis to publish at %s', async (_name, level, agentMode) => {
    await parentSettings(level, agentMode);
    const typed = await loadRunInput(t.db, await sendDo(t, parent, 'tidy the notes', level));
    await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
      typed.identity.runId,
    ]);
    await t.db.query('DELETE FROM jobs WHERE run_id = $1', [typed.identity.runId]);
    const wrapUp = await loadRunInput(t.db, await wrapUpRun());

    expect(wrapUp.chatAsk).toMatchObject({ kind: 'wrap_up' });
    expect(wrapUp.assistantSent).toBe(true);
    expect(startBasis({ ...typed, agentMode })).not.toBeNull();
    expect(await publishScope(t.db, { ...typed, agentMode })).not.toBeNull();
    expect(startBasis(wrapUp)).toBeNull();
    expect(await publishScope(t.db, wrapUp)).toBeNull();
  });
});
