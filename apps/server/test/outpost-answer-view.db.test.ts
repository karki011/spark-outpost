import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestExchanges } from '../src/persistence/outpost-exchanges.ts';
import { requestAnswer } from '../src/persistence/outpost-answers.ts';
import { getPost } from '../src/persistence/outpost-posts.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { FAKE_COMMENTARY } from '../src/providers/fake-phases.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import {
  addMemberChat,
  createOutpostRow,
  deliverRequest,
  finishRun,
  postRunId,
} from './outpost-fixtures.ts';
import { openRoom, post, shown, startStack, type Stack } from './outposts-e2e-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let stacks: Stack[];

const target: ResolveTarget = async () => ({ provider: 'fake' });
const QUESTION = 'I found two shapes.\n\nNeeds you: pick v1 or v2.';

beforeEach(async () => {
  t = await createTestDb();
  stacks = [];
});

afterEach(async () => {
  for (const stack of stacks) await stack.stop();
  await t.cleanup();
});

async function startedRequest(): Promise<{ api: string; postId: string; runId: string }> {
  const outpostId = await createOutpostRow(t);
  const api = await addMemberChat(t, outpostId, 'api');
  const postId = await deliverRequest(t.db, { outpostId, toConversationId: api, toHandle: 'api' });
  expect(await drainQueue(t.db, api, target)).toBe('sent');
  return { api, postId, runId: (await postRunId(t.db, postId))! };
}

async function userSays(api: string, content: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    api,
    { id: randomUUID(), content, source: 'ui' },
    { provider: 'fake' },
  );
  return sent.run.id;
}

async function exchangesOf(postId: string) {
  return requestExchanges(t.db, (await getPost(t.db, postId))!.post);
}

describe('the answer when the agent marks its final message', () => {
  it('leaves the commentary out of the answer and keeps it in the chat reply', async () => {
    const stack = await startStack(t);
    stacks.push(stack);
    const room = await openRoom(stack);
    const request = await post(stack, room.outpostId, '@api #commentary count the files');

    const answered = await eventually(async () => {
      const found = await shown(stack, room.outpostId, request.id);
      return found.state === 'answered' ? found : null;
    });

    expect(answered.answer?.text).toMatch(/^This reply comes from the fake provider/);
    expect(answered.answer?.text).not.toContain(FAKE_COMMENTARY[0]);
    const { rows } = await t.db.query<{ content: string }>(
      `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'`,
      [answered.runId],
    );
    expect(rows[0]?.content).toContain(FAKE_COMMENTARY[0]);
    expect(rows[0]?.content).toContain(FAKE_COMMENTARY[1]);
    expect(rows[0]?.content).toContain('This reply comes from the fake provider');
  });

  it('is the whole reply when the agent marks nothing', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', 'I looked.\n\nThe shape is { id, total }.');

    const answer = await requestAnswer(t.db, t.workspaceId, (await getPost(t.db, postId))!);

    expect(answer?.text).toBe('I looked.\n\nThe shape is { id, total }.');
  });
});

describe('the questions a request was asked on the way', () => {
  it('has none while the first turn is the only one', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', QUESTION);

    expect(await exchangesOf(postId)).toEqual([]);
  });

  it('keeps the question and the user’s answer once the user answers', async () => {
    const { api, postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', QUESTION);
    const second = await userSays(api, 'Use v2.');

    expect(await exchangesOf(postId)).toEqual([{ question: QUESTION, answer: 'Use v2.' }]);

    await finishRun(t.db, second, 'succeeded', 'Done with v2.');
    expect(await exchangesOf(postId)).toEqual([{ question: QUESTION, answer: 'Use v2.' }]);
    const answer = await requestAnswer(t.db, t.workspaceId, (await getPost(t.db, postId))!);
    expect(answer?.text).toBe('Done with v2.');
  });

  it('keeps every round in order when the agent asks again', async () => {
    const { api, postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', QUESTION);
    const second = await userSays(api, 'Use v2.');
    await finishRun(t.db, second, 'succeeded', 'Needs you: confirm the field name.');
    await userSays(api, 'orderId');

    expect(await exchangesOf(postId)).toEqual([
      { question: QUESTION, answer: 'Use v2.' },
      { question: 'Needs you: confirm the field name.', answer: 'orderId' },
    ]);
  });

  it('leaves out turns from before the request and after it was answered', async () => {
    const outpostId = await createOutpostRow(t);
    const api = await addMemberChat(t, outpostId, 'api');
    const earlier = await userSays(api, 'Earlier work.');
    await finishRun(t.db, earlier, 'succeeded', 'Needs you: an older question.');
    const postId = await deliverRequest(t.db, {
      outpostId,
      toConversationId: api,
      toHandle: 'api',
    });
    expect(await drainQueue(t.db, api, target)).toBe('sent');
    await finishRun(t.db, (await postRunId(t.db, postId))!, 'succeeded', 'The shape is v2.');
    await userSays(api, 'Thanks, now something else.');

    expect(await exchangesOf(postId)).toEqual([]);
  });

  it('redacts secrets in both halves', async () => {
    const { api, postId, runId } = await startedRequest();
    const secret = `sk-ant-${'a'.repeat(40)}`;
    await finishRun(t.db, runId, 'succeeded', `Is it ${secret}?\n\nNeeds you: confirm the key.`);
    await userSays(api, 'Yes.');

    const [exchange] = await exchangesOf(postId);
    expect(exchange?.question).not.toContain(secret);
    expect(exchange?.question).toContain('Needs you: confirm the key.');
  });

  it('has none for a note or a request nothing started', async () => {
    const outpostId = await createOutpostRow(t);
    const api = await addMemberChat(t, outpostId, 'api');
    const postId = await deliverRequest(t.db, {
      outpostId,
      toConversationId: api,
      toHandle: 'api',
    });

    expect(await exchangesOf(postId)).toEqual([]);
  });
});
