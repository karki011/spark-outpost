import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wrapRequest } from '../src/outposts/request-prompt.ts';
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

    expect(input.outpostRequest).toEqual({ postId, outpostName: 'Orders launch', fromUser: true });
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

    expect(input.outpostRequest).toEqual({ postId, outpostName: null, fromUser: false });
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
    expect(input.history.map((turn) => turn.content)).toEqual([BODY, 'Needs you: v1 or v2?']);
  });
});
