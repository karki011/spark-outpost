import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestState } from '@spark-outpost/contracts';
import {
  cancelUnsent,
  getPost,
  heldRequests,
  insertPosts,
  markAnswersSeen,
  releaseHold,
  unsentRequests,
} from '../src/persistence/outpost-posts.ts';
import { createOutpost, setPaused } from '../src/persistence/outposts.ts';
import type { NewPost } from '../src/outposts/ports.ts';
import { accept, carry, chatWithTurn, newChat, reply, setRun } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let lead: string;
let api: string;
let web: string;
let first: string;
let held: string;

function storyRequest(to: string, handle: string, afterPostId: string | null): NewPost {
  return {
    id: randomUUID(),
    outpostId,
    kind: 'request',
    body: `Build the ${handle} part.`,
    fromUser: false,
    fromConversationId: lead,
    fromHandle: 'lead',
    toHandle: handle,
    toConversationId: to,
    opening: true,
    userStarted: true,
    afterPostId,
  };
}

beforeEach(async () => {
  t = await createTestDb();
  [lead, api, web] = [await newChat(t), await newChat(t), await newChat(t)];
  outpostId = randomUUID();
  await createOutpost(t.db, {
    id: outpostId,
    workspaceId: t.workspaceId,
    name: 'Orders launch',
    members: [
      { conversationId: lead, handle: 'lead' },
      { conversationId: api, handle: 'api' },
      { conversationId: web, handle: 'web' },
    ],
  });
  const [parent] = await insertPosts(t.db, [storyRequest(api, 'api', null)]);
  first = parent!.id;
  const [dependent] = await insertPosts(t.db, [storyRequest(web, 'web', first)]);
  held = dependent!.id;
});

afterEach(async () => {
  await t.cleanup();
});

async function reasonOf(postId: string) {
  return requestState((await getPost(t.db, postId))!.facts!);
}

async function ids(posts: Promise<{ id: string }[]>): Promise<string[]> {
  return (await posts).map((post) => post.id);
}

async function heldIds(): Promise<string[]> {
  return (await heldRequests(t.db)).map(({ post }) => post.id);
}

async function parentRun(status: Parameters<typeof setRun>[2], answer?: string): Promise<void> {
  const turn = await chatWithTurn(t);
  await t.db.query('UPDATE runs SET conversation_id = $2 WHERE id = $1', [turn.runId, api]);
  await carry(t, first, turn.runId);
  await setRun(t, turn.runId, status);
  if (answer !== undefined) await reply(t, turn.runId, answer);
}

describe('a request held until another is answered', () => {
  it('stores who started it and what it waits for', async () => {
    const stored = (await getPost(t.db, held))!.post;

    expect(stored).toMatchObject({
      fromUser: false,
      fromConversationId: lead,
      fromHandle: 'lead',
      userStarted: true,
      opening: true,
      afterPostId: first,
    });
    expect((await getPost(t.db, first))!.post).toMatchObject({ afterPostId: null });
  });

  it('is left out of the requests to send and listed with the post it waits for', async () => {
    expect(await ids(unsentRequests(t.db))).toEqual([first]);

    const waiting = await heldRequests(t.db);

    expect(waiting.map(({ post, after }) => [post.id, after.post.id])).toEqual([[held, first]]);
    expect(requestState(waiting[0]!.after.facts!)).toEqual({
      state: 'sent',
      reason: 'Not sent yet',
    });
  });

  it('reads Waiting for the chat it depends on until that chat has answered', async () => {
    expect((await getPost(t.db, held))!.facts).toMatchObject({ waitingOn: 'api' });
    expect(await reasonOf(held)).toEqual({ state: 'sent', reason: 'Waiting for @api' });
    expect((await getPost(t.db, first))!.facts).toMatchObject({ waitingOn: null });

    await parentRun('succeeded', 'Done.');

    const [waiting] = await heldRequests(t.db);
    expect(requestState(waiting!.after.facts!).state).toBe('answered');
    expect(await ids(unsentRequests(t.db))).toEqual([]);
  });

  it('shows the parent as needing the user when its answer ends with Needs you', async () => {
    await parentRun('succeeded', 'Half done.\n\nNeeds you: which schema?');

    const [waiting] = await heldRequests(t.db);

    expect(requestState(waiting!.after.facts!)).toEqual({
      state: 'needs_you',
      reason: 'which schema?',
    });
  });

  it('stays held, with the same rows, when the parent turn was interrupted by a restart', async () => {
    await parentRun('outcome_unknown');

    const [waiting] = await heldRequests(t.db);

    expect(waiting?.post.id).toBe(held);
    expect(requestState(waiting!.after.facts!).state).toBe('failed');
    expect(await heldIds()).toEqual([held]);
    expect(await reasonOf(held)).toEqual({ state: 'sent', reason: "Waiting: @api's turn failed" });
  });

  it('is neither sent nor released while the outpost is paused, and reads Paused', async () => {
    await setPaused(t.db, t.workspaceId, outpostId, true);

    expect(await heldRequests(t.db)).toEqual([]);
    expect(await unsentRequests(t.db)).toEqual([]);
    expect(await reasonOf(held)).toEqual({ state: 'sent', reason: 'Paused' });

    await setPaused(t.db, t.workspaceId, outpostId, false);
    expect(await heldIds()).toEqual([held]);
  });

  it('waits for a deleted chat when the chat it depends on is deleted', async () => {
    await t.db.query('DELETE FROM conversations WHERE id = $1', [api]);

    const facts = (await getPost(t.db, held))!.facts;

    expect(facts).toMatchObject({ waitingOn: null, waitingOnDeleted: true });
    expect(await reasonOf(held)).toEqual({ state: 'sent', reason: 'Waiting for a deleted chat' });
    const [waiting] = await heldRequests(t.db);
    expect(requestState(waiting!.after.facts!)).toEqual({
      state: 'failed',
      reason: 'Chat deleted',
    });
  });

  it('is released by Start anyway once, and then goes out like any request', async () => {
    expect(await releaseHold(t.db, held)).toBe(true);
    expect(await releaseHold(t.db, held)).toBe(false);

    expect(await heldRequests(t.db)).toEqual([]);
    expect(await ids(unsentRequests(t.db))).toEqual([first, held]);
    expect((await getPost(t.db, held))!.facts).toMatchObject({ waitingOn: null });
    expect(await reasonOf(held)).toEqual({ state: 'sent', reason: 'Not sent yet' });
  });

  it('ignores a late Start anyway for a request already sent, cancelled or not held', async () => {
    const [sent] = await insertPosts(t.db, [storyRequest(web, 'web', first)]);
    await accept(t, sent!.id);
    await cancelUnsent(t.db, held);

    expect(await releaseHold(t.db, sent!.id)).toBe(false);
    expect(await releaseHold(t.db, held)).toBe(false);
    expect(await releaseHold(t.db, first)).toBe(false);
    expect(await releaseHold(t.db, randomUUID())).toBe(false);
    expect((await getPost(t.db, sent!.id))!.post.afterPostId).toBe(first);
    expect((await getPost(t.db, sent!.id))!.facts).toMatchObject({ waitingOn: null });
    expect(await heldRequests(t.db)).toEqual([]);
  });

  it('leaves out a held request that was cancelled or whose own chat was deleted', async () => {
    const [other] = await insertPosts(t.db, [storyRequest(lead, 'lead', first)]);
    await cancelUnsent(t.db, held);
    expect(await heldIds()).toEqual([other!.id]);

    await t.db.query('DELETE FROM conversations WHERE id = $1', [lead]);

    expect(await heldRequests(t.db)).toEqual([]);
  });

  it('goes out as an ordinary request when the post it waited for is deleted', async () => {
    await t.db.query('DELETE FROM outpost_posts WHERE id = $1', [first]);

    expect(await heldRequests(t.db)).toEqual([]);
    expect(await ids(unsentRequests(t.db))).toEqual([held]);
  });
});

describe('claiming answers for one turn', () => {
  it('claims each answer once, however many turns ask at the same time', async () => {
    const claims = await Promise.all([1, 2, 3, 4].map(() => markAnswersSeen(t.db, [first, held])));

    expect(claims.flat().toSorted()).toEqual([first, held].toSorted());
    expect(claims.filter((claimed) => claimed.length > 0)).toHaveLength(1);
    expect(await markAnswersSeen(t.db, [held, first])).toEqual([]);
    expect((await getPost(t.db, first))!.post.answerSeenAt).not.toBeNull();
  });

  it('returns only the ids it claimed, in the order asked, and nothing for an empty list', async () => {
    expect(await markAnswersSeen(t.db, [])).toEqual([]);
    expect(await markAnswersSeen(t.db, [held])).toEqual([held]);

    expect(await markAnswersSeen(t.db, [held, randomUUID(), first, first])).toEqual([first]);
  });

  it('does not claim a note', async () => {
    const [note] = await insertPosts(t.db, [
      { id: randomUUID(), outpostId, kind: 'note', body: 'Shipping Friday.', fromUser: true },
    ]);

    expect(await markAnswersSeen(t.db, [note!.id])).toEqual([]);
  });
});
