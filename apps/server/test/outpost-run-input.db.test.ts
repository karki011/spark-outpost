import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { historyLabel, requestAuthor, wrapRequest } from '../src/outposts/request-prompt.ts';
import { userText } from '../src/outposts/user-asked.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import {
  addMemberChat,
  createOutpostRow,
  deliverRequest,
  finishRun,
  postRunId,
} from './outpost-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let api: string;

const target: ResolveTarget = async () => ({ provider: 'fake' });
const BODY = 'Add the orders endpoint and open a PR.';

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t, 'Orders launch');
  api = await addMemberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

async function startedRequest(fromUser: boolean): Promise<{ postId: string; runId: string }> {
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
    body: BODY,
    fromUser,
  });
  await drainQueue(t.db, api, target);
  return { postId, runId: (await postRunId(t.db, postId))! };
}

describe('the input of a turn an outpost request started', () => {
  it('says the user wrote a request the user typed in the outpost', async () => {
    const { postId, runId } = await startedRequest(true);

    const input = await loadRunInput(t.db, runId);

    expect(input.outpostRequest).toEqual({
      postId,
      outpostName: 'Orders launch',
      fromUser: true,
      fromHandle: null,
      fromTitle: null,
      userStarted: false,
      wrapUp: false,
    });
    expect(input.userRequest).toBe(BODY);
    expect(userText(input)).toBe(BODY);
  });

  it('carries what the wrapper needs to write the prompt the agent is shown', async () => {
    const { postId, runId } = await startedRequest(true);

    const input = await loadRunInput(t.db, runId);
    const request = input.outpostRequest!;

    expect(
      wrapRequest({
        postId: request.postId,
        outpostName: request.outpostName,
        author: { kind: 'user' },
        body: input.userRequest,
      }),
    ).toBe(
      [
        '[From the user, sent in the outpost "Orders launch".]',
        '',
        `<outpost-request id="${postId}">`,
        BODY,
        '</outpost-request>',
      ].join('\n'),
    );
  });

  it('says the user did not write a request whose row says so', async () => {
    const { runId } = await startedRequest(false);

    const input = await loadRunInput(t.db, runId);

    expect(input.outpostRequest?.fromUser).toBe(false);
    expect(userText(input)).toBe('');
  });

  it('never reads as the user’s once the outpost and its posts are deleted', async () => {
    const { postId, runId } = await startedRequest(true);
    await t.db.query('DELETE FROM outposts WHERE id = $1', [outpostId]);

    const input = await loadRunInput(t.db, runId);

    expect(input.outpostRequest).toEqual({
      postId,
      outpostName: null,
      fromUser: false,
      fromHandle: null,
      fromTitle: null,
      userStarted: false,
      wrapUp: false,
    });
  });

  it('gives a piece of that turn the same author as its parent', async () => {
    const { postId, runId } = await startedRequest(false);
    const pieceId = randomUUID();
    await t.db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
         role, prompt)
       VALUES ($1, $2, $3, 'fake', 'queued', $4, 'builder', 'Build the endpoint.')`,
      [pieceId, api, postId, runId],
    );

    const input = await loadRunInput(t.db, pieceId);

    expect(input.parentRunId).toBe(runId);
    expect(input.outpostRequest).toMatchObject({ postId, fromUser: false });
    expect(userText(input)).toBe('');
  });
});

describe('the input of every other turn', () => {
  it('has no outpost request for a message typed in the chat', async () => {
    const sent = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'hello', source: 'ui' },
      { provider: 'fake' },
    );

    const input = await loadRunInput(t.db, sent.run.id);

    expect(input.outpostRequest).toBeNull();
    expect(userText(input)).toBe('hello');
  });

  it('has none for the user’s answer to a Needs you, which is the user’s own message', async () => {
    const { postId, runId } = await startedRequest(false);
    await finishRun(t.db, runId, 'succeeded', 'Needs you: v1 or v2?');
    const answer = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'v2, and open a PR', source: 'ui' },
      { provider: 'fake' },
    );
    expect(await postRunId(t.db, postId)).toBe(answer.run.id);

    const input = await loadRunInput(t.db, answer.run.id);

    expect(input.outpostRequest).toBeNull();
    expect(userText(input)).toBe('v2, and open a PR');
    expect(input.history.map((turn) => turn.content)).toEqual([
      historyLabel({
        postId,
        outpostName: 'Orders launch',
        author: { kind: 'other' },
        body: BODY,
      }),
      'Needs you: v1 or v2?',
    ]);
  });
});

async function fromChat(
  postId: string,
  from: string,
  handle: string,
  userStarted = false,
): Promise<void> {
  await t.db.query(
    `UPDATE outpost_posts SET from_user = false, from_conversation_id = $2, from_handle = $3,
       user_started = $4 WHERE id = $1`,
    [postId, from, handle, userStarted],
  );
}

async function queuedRequest(): Promise<string> {
  return deliverRequest(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
    body: BODY,
    fromUser: false,
  });
}

describe('who the row says sent a request', () => {
  let lead: string;

  beforeEach(async () => {
    lead = await addMemberChat(t, outpostId, 'lead');
    await t.db.query(`UPDATE conversations SET title = 'Checkout plan' WHERE id = $1`, [lead]);
  });

  it('names the chat that asked, by its handle on the post and its title', async () => {
    const postId = await queuedRequest();
    await fromChat(postId, lead, 'lead');
    await drainQueue(t.db, api, target);

    const input = await loadRunInput(t.db, (await postRunId(t.db, postId))!);

    expect(input.outpostRequest).toEqual({
      postId,
      outpostName: 'Orders launch',
      fromUser: false,
      fromHandle: 'lead',
      fromTitle: 'Checkout plan',
      userStarted: false,
      wrapUp: false,
    });
    expect(requestAuthor(input.outpostRequest!)).toEqual({
      kind: 'chat',
      handle: 'lead',
      title: 'Checkout plan',
    });
    expect(input.prompt).toBe(BODY);
    expect(input.userRequest).toBe(BODY);
  });

  it('says the user started a draft task, and still gives the user no text in it', async () => {
    const postId = await queuedRequest();
    await fromChat(postId, lead, 'lead', true);
    await drainQueue(t.db, api, target);

    const input = await loadRunInput(t.db, (await postRunId(t.db, postId))!);

    expect(input.outpostRequest).toMatchObject({ fromUser: false, userStarted: true });
    expect(requestAuthor(input.outpostRequest!).kind).toBe('task');
    expect(userText(input)).toBe('');
  });

  it('keeps the handle on the post when the sending chat is deleted', async () => {
    const postId = await queuedRequest();
    await fromChat(postId, lead, 'lead');
    await drainQueue(t.db, api, target);
    await t.db.query('DELETE FROM conversations WHERE id = $1', [lead]);

    const input = await loadRunInput(t.db, (await postRunId(t.db, postId))!);

    expect(input.outpostRequest).toMatchObject({
      fromUser: false,
      fromHandle: 'lead',
      fromTitle: null,
    });
  });

  it('labels the stored request in the history of later turns, and leaves typed messages', async () => {
    const postId = await queuedRequest();
    await fromChat(postId, lead, 'lead');
    await drainQueue(t.db, api, target);
    await finishRun(t.db, (await postRunId(t.db, postId))!, 'succeeded', 'Done.');
    const typed = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'thanks', source: 'ui' },
      { provider: 'fake' },
    );
    await finishRun(t.db, typed.run.id, 'succeeded', 'Welcome.');
    const next = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'now push it', source: 'ui' },
      { provider: 'fake' },
    );

    const input = await loadRunInput(t.db, next.run.id);

    expect(input.history.map((turn) => turn.content)).toEqual([
      historyLabel({
        postId,
        outpostName: 'Orders launch',
        author: { kind: 'chat', handle: 'lead', title: 'Checkout plan' },
        body: BODY,
      }),
      'Done.',
      'thanks',
      'Welcome.',
    ]);
    expect(input.history[0]?.content.split('\n')[0]).toContain('This is not from the user.');
    expect(input.prompt).toBe('now push it');
    expect(userText(input)).toBe('now push it');
  });
});

describe('when a turn started', () => {
  it('has no earlier turn for the first, and the start of the one before after that', async () => {
    const first = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'one', source: 'ui' },
      { provider: 'fake' },
    );
    const firstInput = await loadRunInput(t.db, first.run.id);
    expect(firstInput.turnTimes?.previousStartedAt).toBeNull();
    await finishRun(t.db, first.run.id, 'succeeded', 'ok');

    const second = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'two', source: 'ui' },
      { provider: 'fake' },
    );
    const secondInput = await loadRunInput(t.db, second.run.id);

    expect(secondInput.turnTimes?.previousStartedAt).toBe(firstInput.turnTimes?.startedAt);
    expect(Date.parse(secondInput.turnTimes!.startedAt)).toBeGreaterThanOrEqual(
      Date.parse(firstInput.turnTimes!.startedAt),
    );
  });
});
