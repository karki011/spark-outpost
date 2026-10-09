import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { continueOpenRequest, continuesRequest } from '../src/outposts/continuation.ts';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import {
  addMemberChat,
  chatTurns,
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
const NEEDS_YOU = 'I found two shapes.\n\nNeeds you: pick v1 or v2.';

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t);
  api = await addMemberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

async function startedRequest(
  body = 'Which response shape?',
): Promise<{ postId: string; runId: string }> {
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
    body,
  });
  expect(await drainQueue(t.db, api, target)).toBe('sent');
  return { postId, runId: (await postRunId(t.db, postId))! };
}

async function userAnswers(content = 'Use v2.', source?: 'ui'): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    api,
    { id: randomUUID(), content, ...(source ? { source } : {}) },
    { provider: 'fake' },
  );
  return sent.run.id;
}

describe('which turn continues a request', () => {
  const needsYou = { source: 'ui', previousStatus: 'succeeded', previousReply: NEEDS_YOU };

  it('is a turn the user sent after a reply that ended with Needs you', () => {
    expect(continuesRequest(needsYou)).toBe(true);
    expect(continuesRequest({ ...needsYou, source: null })).toBe(true);
    expect(continuesRequest({ ...needsYou, source: 'queue' })).toBe(true);
  });

  it('is never a turn something else started', () => {
    for (const source of ['outpost', 'pr_follow_up', 'ticket', 'slack', 'digest']) {
      expect(continuesRequest({ ...needsYou, source })).toBe(false);
    }
  });

  it('needs the earlier turn to have succeeded and asked', () => {
    expect(continuesRequest({ ...needsYou, previousStatus: 'failed' })).toBe(false);
    expect(continuesRequest({ ...needsYou, previousStatus: 'awaiting_approval' })).toBe(false);
    expect(continuesRequest({ ...needsYou, previousReply: 'Use v2. Done.' })).toBe(false);
    expect(continuesRequest({ ...needsYou, previousReply: null })).toBe(false);
  });
});

describe('answering a Needs you request', () => {
  it('moves the request to the user’s next turn in that chat', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', NEEDS_YOU);

    const answer = await userAnswers('Use v2.', 'ui');

    expect(answer).not.toBe(runId);
    expect(await postRunId(t.db, postId)).toBe(answer);
  });

  it('moves it again when the answer turn also ends with Needs you', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', NEEDS_YOU);
    const second = await userAnswers();
    await finishRun(t.db, second, 'succeeded', 'Needs you: confirm the field name.');

    const third = await userAnswers('orderId');

    expect(await postRunId(t.db, postId)).toBe(third);
  });

  it('is continued by a message the user had queued', async () => {
    const { postId, runId } = await startedRequest();
    const queued = randomUUID();
    await addToQueue(t.db, api, { id: queued, content: 'Use v2.' });
    await finishRun(t.db, runId, 'succeeded', NEEDS_YOU);

    expect(await drainQueue(t.db, api, target)).toBe('sent');

    const turns = await chatTurns(t.db, api);
    expect(turns.at(-1)).toMatchObject({ source: 'queue', user_message_id: queued });
    expect(await postRunId(t.db, postId)).toBe(turns.at(-1)!.id);
  });

  it('leaves an answered request on the run that answered it', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', 'The shape is { id, total }.');

    await userAnswers('Thanks, now something else.');

    expect(await postRunId(t.db, postId)).toBe(runId);
  });

  it('leaves a failed request where it failed', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'failed', NEEDS_YOU);

    await userAnswers();

    expect(await postRunId(t.db, postId)).toBe(runId);
  });

  it('leaves a request the user cancelled where it was', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', NEEDS_YOU);
    await t.db.query(
      `UPDATE outpost_posts SET closed_state = 'cancelled', closed_at = now() WHERE id = $1`,
      [postId],
    );

    await userAnswers();

    expect(await postRunId(t.db, postId)).toBe(runId);
  });

  it('does nothing in a chat with no open request', async () => {
    const first = await userAnswers('hello');
    await finishRun(t.db, first, 'succeeded', NEEDS_YOU);

    const second = await userAnswers('v2');

    await expect(continueOpenRequest(t.db, api, second)).resolves.toBeUndefined();
    const posts = await t.db.query('SELECT 1 FROM outpost_posts WHERE run_id IS NOT NULL');
    expect(posts.rowCount).toBe(0);
  });

  it('is not continued by the next outpost request, only by the user', async () => {
    const first = await startedRequest('first');
    await finishRun(t.db, first.runId, 'succeeded', NEEDS_YOU);

    const second = await startedRequest('second');

    expect(second.runId).not.toBe(first.runId);
    expect(await postRunId(t.db, first.postId)).toBe(first.runId);
  });

  it('with two requests, moves only the one on the chat’s latest turn', async () => {
    const first = await startedRequest('first');
    await finishRun(t.db, first.runId, 'succeeded', NEEDS_YOU);
    const second = await startedRequest('second');
    await finishRun(t.db, second.runId, 'succeeded', NEEDS_YOU);

    const answer = await userAnswers();

    expect(await postRunId(t.db, second.postId)).toBe(answer);
    expect(await postRunId(t.db, first.postId)).toBe(first.runId);
  });

  it('does not touch another chat’s request', async () => {
    const web = await addMemberChat(t, outpostId, 'fe');
    const other = await deliverRequest(t.db, {
      outpostId,
      toConversationId: web,
      toHandle: 'fe',
      body: 'Build the page.',
    });
    await drainQueue(t.db, web, target);
    const otherRun = (await postRunId(t.db, other))!;
    await finishRun(t.db, otherRun, 'succeeded', NEEDS_YOU);
    const mine = await startedRequest();
    await finishRun(t.db, mine.runId, 'succeeded', NEEDS_YOU);

    const answer = await userAnswers();

    expect(await postRunId(t.db, mine.postId)).toBe(answer);
    expect(await postRunId(t.db, other)).toBe(otherRun);
  });
});
