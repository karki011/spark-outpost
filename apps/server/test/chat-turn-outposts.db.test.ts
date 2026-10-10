import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestState } from '@spark-outpost/contracts';
import { SPARK_HANDOFF_HEADER, SPARK_JOB_HEADER } from '../src/orchestration/spark-job.ts';
import { OUTPOST_REQUEST_METHOD } from '../src/outposts/request-audit.ts';
import { wrapRequest } from '../src/outposts/request-prompt.ts';
import { queueWrapUps } from '../src/outposts/story-wrap-ups.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { markStarted, saveDraft } from '../src/persistence/outpost-drafts.ts';
import { getPost, insertPosts } from '../src/persistence/outpost-posts.ts';
import { insertTasks } from '../src/persistence/outpost-stories.ts';
import { getRun } from '../src/persistence/runs.ts';
import { replyText } from '../src/persistence/spark-mentions.ts';
import { createTeammate } from '../src/persistence/teammates.ts';
import { runChatTurn } from '../src/workflow/chat-turn.ts';
import { chatPromptFacts } from '../src/workflow/chat-turn-prompt.ts';
import { chatTarget, drainQueue } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { addMemberChat, createOutpostRow, deliverRequest, postRunId } from './outpost-fixtures.ts';
import { accept, carry, chatWithTurn, reply, setRun } from './outpost-store-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import {
  auditOf,
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  repliesOf,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let worker: Worker;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectAgents(t);
  worker = startTurnWorker(t, { runTurn: runChatTurn });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
});

async function finished(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 60_000);
}

interface ChildRow {
  id: string;
  role: string;
  mode: string;
  status: string;
}

async function children(runId: string): Promise<ChildRow[]> {
  const { rows } = await t.db.query<ChildRow>(
    'SELECT id, role, mode, status FROM runs WHERE parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  return rows;
}

function pip() {
  return createTeammate(t.db, t.workspaceId, {
    name: 'Pip',
    role: 'Code reviewer',
    provider: null,
    model: null,
    agentMode: null,
    level: null,
    instructions: 'Always name the file and line you mean.',
    projectIds: [],
  });
}

describe('a chat turn that mentions a Spark', { timeout: 60_000 }, () => {
  it('runs the Spark as a read-only child run and ends with its hand-off note', async () => {
    await pip();
    const conversationId = await openChat(t, { root });
    const runId = await sendMessage(t, conversationId, '@Pip review parseDate');

    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    const [child, ...others] = await children(runId);
    expect(others).toEqual([]);
    expect(child).toMatchObject({ role: 'spark', mode: 'ask', status: 'succeeded' });
    expect(await replyText(t.db, child!.id)).toContain(SPARK_JOB_HEADER);
    const [note, ...more] = await repliesOf(t, runId);
    expect(more).toEqual([]);
    expect(note).toContain(SPARK_HANDOFF_HEADER);
    expect(note).toContain('The main agent did not run for this message.');
  });

  it('hands the Spark’s note to the chat’s agent when the message goes on', async () => {
    await pip();
    const conversationId = await openChat(t, { root });
    const runId = await sendMessage(t, conversationId, '@Pip review parseDate, then summarise it');

    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(await children(runId)).toMatchObject([{ role: 'spark' }]);
    const [answer] = await repliesOf(t, runId);
    const prompt = answer!.slice(answer!.indexOf('prompt='));
    expect(prompt).toContain('@Pip review parseDate, then summarise it');
    expect(prompt).toContain(SPARK_HANDOFF_HEADER);
  });
});

describe('a chat turn started by an outpost request', { timeout: 60_000 }, () => {
  let outpostId: string;
  let api: string;

  beforeEach(async () => {
    outpostId = await createOutpostRow(t, 'Orders launch');
    api = await addMemberChat(t, outpostId, 'api');
  });

  async function requestTurn(body: string, fromUser: boolean) {
    const postId = await deliverRequest(t.db, {
      outpostId,
      toConversationId: api,
      toHandle: 'api',
      body,
      fromUser,
    });
    expect(await drainQueue(t.db, api, chatTarget(t.db))).toBe('sent');
    const runId = (await postRunId(t.db, postId))!;
    const run = await finished(runId);
    return { postId, runId, run };
  }

  async function requestAudit(runId: string) {
    const entries = await auditOf(t, runId);
    return entries.filter((entry) => entry.method === OUTPOST_REQUEST_METHOD);
  }

  it('gives the agent the user’s request with its label and records it in the audit', async () => {
    const body = 'Push it and open a pull request.';

    const { postId, runId, run } = await requestTurn(body, true);

    expect(run.status).toBe('succeeded');
    const wrapped = wrapRequest({
      postId,
      outpostName: 'Orders launch',
      author: { kind: 'user' },
      body,
    });
    expect((await repliesOf(t, runId))[0]).toContain(wrapped);
    expect(await requestAudit(runId)).toMatchObject([
      { payload: { params: { postId, fromUser: true, textLength: body.length } } },
    ]);
    const facts = await chatPromptFacts(t.db, await loadRunInput(t.db, runId));
    expect(facts.publishAsked).toBe(true);
    expect(await loadOrchestration(t.db, runId)).toBeNull();
  });

  it('never reads another chat’s request as the user asking to publish', async () => {
    const body = 'Push it and open a pull request.';

    const { postId, runId, run } = await requestTurn(body, false);

    expect(run.status).toBe('succeeded');
    const wrapped = wrapRequest({
      postId,
      outpostName: 'Orders launch',
      author: { kind: 'other' },
      body,
    });
    expect((await repliesOf(t, runId))[0]).toContain(wrapped);
    expect(await requestAudit(runId)).toMatchObject([
      { payload: { params: { postId, fromUser: false } } },
    ]);
    const facts = await chatPromptFacts(t.db, await loadRunInput(t.db, runId));
    expect(facts.publishAsked).toBe(false);
  });

  async function settledStory(lead: string): Promise<string> {
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

  it('answers a story’s wrap-up in one read-only reply, even in a changing mode', async () => {
    const lead = await openChat(t, { root, level: 'full-auto' });
    await t.db.query(
      `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
       VALUES ($1, $2, 'lead', 0)`,
      [outpostId, lead],
    );
    await updateChatSettings(t.db, lead, {
      provider: 'claude',
      agentMode: 'acceptEdits',
      level: 'full-auto',
    });
    const draftId = await settledStory(lead);
    expect(await queueWrapUps(t.db)).toBe(1);
    await accept(t, draftId);
    expect(await drainQueue(t.db, lead, chatTarget(t.db))).toBe('sent');
    const runId = (await postRunId(t.db, draftId))!;

    const run = await finished(runId);

    expect(run).toMatchObject({ status: 'succeeded', mode: 'ask', role: null });
    expect(await children(runId)).toEqual([]);
    expect(await loadOrchestration(t.db, runId)).toBeNull();
    expect(await repliesOf(t, runId)).toHaveLength(1);
    const post = (await getPost(t.db, run.outpost!.postId))!;
    expect(requestState(post.facts!).state).toBe('answered');
  });
});
