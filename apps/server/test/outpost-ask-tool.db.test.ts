import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { turnObservations } from '../src/persistence/observations.ts';
import { getPost, listPosts } from '../src/persistence/outpost-posts.ts';
import { outpostAskTool } from '../src/spark-mcp/tools/outpost-ask-tool.ts';
import { NOT_THE_CHATS_TURN, NOT_IN_OUTPOST } from '../src/spark-mcp/tools/outpost-turn.ts';
import {
  CANNOT_ASK_SELF,
  CHATS_CANNOT_ASK_ALL,
  OUTPOST_PAUSED,
  REQUEST_STARTED_TURN,
} from '../src/outposts/post-rules.ts';
import { addMemberChat, createOutpostRow, finishRun, pauseOutpost } from './outpost-fixtures.ts';
import { carry } from './outpost-store-support.ts';
import {
  chatAsk,
  memberWithTurn,
  outpostChanged,
  sparkRun,
  requestStartedTurn,
  toolHarness,
  type MemberTurn,
} from './outpost-tool-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let web: MemberTurn;
let api: MemberTurn;

interface Asked {
  request: string;
  state: string;
  waited: boolean;
  note?: string;
  answer?: string;
  untrusted?: string;
}

const QUESTION = 'What does GET /orders return?';

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t);
  web = await memberWithTurn(t, outpostId, 'web');
  api = await memberWithTurn(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

function ask(turn: Pick<MemberTurn, 'conversationId' | 'runId'>, args: Record<string, unknown>) {
  const harness = toolHarness(t, turn);
  return { harness, result: outpostAskTool.run(args, harness.context) as Promise<Asked> };
}

async function requests() {
  return (await listPosts(t.db, outpostId)).filter(({ post }) => post.kind === 'request');
}

describe('spark_outpost_ask', () => {
  it('sends a request written by the chat, never by the user, and does not wait when told not to', async () => {
    const { harness, result } = ask(web, { to: 'api', text: QUESTION, wait: false });
    const asked = await result;
    const stored = (await getPost(t.db, asked.request))!.post;
    expect(asked).toMatchObject({ state: 'sent', waited: false });
    expect(stored).toMatchObject({
      kind: 'request',
      body: QUESTION,
      fromUser: false,
      fromConversationId: web.conversationId,
      fromHandle: 'web',
      fromRunId: web.runId,
      toConversationId: api.conversationId,
      waits: false,
      userStarted: false,
    });
    expect(harness.wakes.waiters).toBe(0);
  });

  it('accepts a handle written with @', async () => {
    const asked = await ask(web, { to: '@api', text: QUESTION, wait: false }).result;
    expect((await getPost(t.db, asked.request))!.post.toHandle).toBe('api');
  });

  it('audits the ask with ids and a hash, never the text', async () => {
    const { harness, result } = ask(web, { to: 'api', text: QUESTION, wait: false });
    const asked = await result;
    expect(harness.audited).toHaveLength(1);
    expect(harness.audited[0]!.method).toBe('spark/outpost_ask');
    expect(harness.audited[0]!.params).toMatchObject({
      postId: asked.request,
      outpostId,
      fromUser: false,
      fromConversationId: web.conversationId,
      toConversationId: api.conversationId,
      textLength: QUESTION.length,
    });
    expect(JSON.stringify(harness.audited)).not.toContain('orders');
  });

  it('waits by default and returns the answer once, with the answering turn’s read labels', async () => {
    const { harness, result } = ask(web, { to: 'api', text: QUESTION });
    await eventually(async () => harness.wakes.waiters === 1);
    const [sent] = await requests();
    expect(sent!.post.waits).toBe(true);
    await t.db.query(
      `INSERT INTO run_observations (id, run_id, conversation_id, source, label)
       VALUES (gen_random_uuid(), $1, $2, 'web_page', 'web page example.com')`,
      [api.runId, api.conversationId],
    );
    await carry(t, sent!.post.id, api.runId);
    await finishRun(t.db, api.runId, 'succeeded', 'A list of orders.');
    outpostChanged(harness.wakes, outpostId);
    const asked = await result;
    expect(asked).toMatchObject({ state: 'answered', waited: true, answer: 'A list of orders.' });
    expect(asked.untrusted).toBeTruthy();
    expect((await getPost(t.db, asked.request))!.post.answerSeenAt).not.toBeNull();
    expect(await turnObservations(t.db, web.runId)).toEqual(
      expect.arrayContaining([
        { source: 'private_data', label: 'private work data (outpost answer)' },
        { source: 'web_page', label: 'web page example.com' },
      ]),
    );
  });

  it('returns when the turn is stopped and says the request goes on', async () => {
    const { harness, result } = ask(web, { to: 'api', text: QUESTION });
    await eventually(async () => harness.wakes.waiters === 1);
    harness.stop.abort();
    const asked = await result;
    expect(asked).toMatchObject({ state: 'sent', waited: true });
    expect((await getPost(t.db, asked.request))!.post.answerSeenAt).toBeNull();
  });

  it('does not wait on a chat whose running turn waits on this chat, and says so', async () => {
    await chatAsk(t, outpostId, api, web);
    const { harness, result } = ask(web, { to: 'api', text: QUESTION });
    const asked = await result;
    expect(asked).toMatchObject({ state: 'sent', waited: false });
    expect(asked.note).toContain('@api is waiting');
    expect((await getPost(t.db, asked.request))!.post.waits).toBe(false);
    expect(harness.wakes.waiters).toBe(0);
  });

  it('refuses from a turn another chat’s request started', async () => {
    const docs = { conversationId: await addMemberChat(t, outpostId, 'docs'), handle: 'docs' };
    const turn = await requestStartedTurn(t, outpostId, docs, 'chat', web);
    await expect(ask(turn, { to: 'api', text: QUESTION, wait: false }).result).rejects.toThrow(
      REQUEST_STARTED_TURN,
    );
    expect(await requests()).toHaveLength(1);
  });

  it('asks from a turn the user started from a draft, and from a request the user wrote', async () => {
    const docs = { conversationId: await addMemberChat(t, outpostId, 'docs'), handle: 'docs' };
    const drafted = await requestStartedTurn(t, outpostId, docs, 'draft', web);
    const first = await ask(drafted, { to: 'web', text: QUESTION, wait: false }).result;
    expect(first.state).toBe('sent');
    const ops = { conversationId: await addMemberChat(t, outpostId, 'ops'), handle: 'ops' };
    const typed = await requestStartedTurn(t, outpostId, ops, 'user');
    const second = await ask(typed, { to: 'web', text: QUESTION, wait: false }).result;
    expect(second.state).toBe('sent');
  });

  it('refuses itself, a chat outside the outpost, @all and a paused outpost', async () => {
    const send = (to: string) => ask(web, { to, text: QUESTION, wait: false }).result;
    await expect(send('web')).rejects.toThrow(CANNOT_ASK_SELF);
    await expect(send('billing')).rejects.toThrow('@billing is not in this outpost.');
    await expect(send('all')).rejects.toThrow(CHATS_CANNOT_ASK_ALL);
    await pauseOutpost(t.db, outpostId, true);
    await expect(send('api')).rejects.toThrow(OUTPOST_PAUSED);
    expect(await requests()).toHaveLength(0);
  });

  it('refuses a Spark the member chat handed a job to, and a chat that is in no outpost', async () => {
    const spark = { conversationId: web.conversationId, runId: await sparkRun(t, web.runId) };
    await expect(ask(spark, { to: 'api', text: QUESTION, wait: false }).result).rejects.toThrow(
      NOT_THE_CHATS_TURN,
    );
    const outside = await startChat(t, 'elsewhere');
    await expect(ask(outside, { to: 'api', text: QUESTION, wait: false }).result).rejects.toThrow(
      NOT_IN_OUTPOST,
    );
  });

  it('does not wait when this process has no wake to wait on, and says so', async () => {
    const harness = toolHarness(t, web);
    const context = { ...harness.context, deps: { db: t.db } as typeof harness.context.deps };
    const asked = (await outpostAskTool.run({ to: 'api', text: QUESTION }, context)) as Asked;
    expect(asked).toMatchObject({ state: 'sent', waited: false });
    expect(asked.note).toBeTruthy();
  });

  it('is an action tool with no confirm card', () => {
    expect(outpostAskTool.acts).toBe(true);
    expect(outpostAskTool.needs).toBe('outpost');
  });
});
