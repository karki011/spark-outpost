import { randomUUID } from 'node:crypto';
import {
  heldForRequest,
  requestState,
  type AppEvent,
  type RunStatus,
} from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDispatcher } from '../src/a2a/dispatcher.ts';
import { releaseAnswered } from '../src/a2a/hold-release.ts';
import type { NewPost } from '../src/outposts/ports.ts';
import { cancelPost } from '../src/persistence/outpost-tasks.ts';
import { getPost, insertPosts } from '../src/persistence/outpost-posts.ts';
import { createOutpost, setPaused } from '../src/persistence/outposts.ts';
import { setSparkPaused } from '../src/persistence/spark-pause.ts';
import { acceptingPeer, type AcceptingPeer } from './accepting-peer.ts';
import { chatWithTurn, newChat, reply, setRun } from './outpost-store-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let peer: AcceptingPeer;
let outpostId: string;
let lead: string;
let api: string;
let web: string;
let first: string;
let held: string;

const changed: AppEvent = { kind: 'outpost_changed', conversationId: null, runId: null };

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

async function onePass(): Promise<void> {
  await startDispatcher({ db: t.db, peer }).close();
}

function sentIds(): string[] {
  return peer.sent.map((sent) => sent.postId);
}

async function parentTurn(status: RunStatus, answer?: string): Promise<void> {
  const turn = await chatWithTurn(t);
  await t.db.query('UPDATE runs SET conversation_id = $2 WHERE id = $1', [turn.runId, api]);
  await t.db.query('DELETE FROM chat_queue WHERE outpost_post_id = $1', [first]);
  await t.db.query('UPDATE outpost_posts SET run_id = $2 WHERE id = $1', [first, turn.runId]);
  if (answer !== undefined) await reply(t, turn.runId, answer);
  await setRun(t, turn.runId, status);
}

async function stored(postId: string) {
  return (await getPost(t.db, postId))!;
}

beforeEach(async () => {
  t = await createTestDb();
  peer = acceptingPeer(t);
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

describe('a request that starts after another', () => {
  it('is not sent while the request it waits on has no answer', async () => {
    await onePass();
    expect(sentIds()).toEqual([first]);

    await parentTurn('running');
    await onePass();

    expect(sentIds()).toEqual([first]);
    expect((await stored(held)).post).toMatchObject({ taskId: null, afterPostId: first });
    expect(requestState((await stored(held)).facts!).reason).toBe('Waiting for @api');
  });

  it('is sent, with its own text and once, when the other request is answered', async () => {
    await onePass();
    await parentTurn('succeeded', 'The endpoint is in.');

    await onePass();
    await onePass();

    expect(peer.sent.slice(1)).toEqual([
      { postId: held, outpostId, toConversationId: web, body: 'Build the web part.' },
    ]);
    const after = (await stored(held)).post;
    expect(after.afterPostId).toBeNull();
    expect(after.taskId).not.toBeNull();
    expect(after).toMatchObject({ fromUser: false, userStarted: true, fromConversationId: lead });
  });

  it('stays held when the other request ends by asking the user', async () => {
    await onePass();
    await parentTurn('succeeded', 'Half done.\n\nNeeds you: which schema?');

    await onePass();

    expect(sentIds()).toEqual([first]);
    expect((await stored(held)).post.afterPostId).toBe(first);
  });

  it('stays held when the question is a line of its own and Spark adds a line after it', async () => {
    await onePass();
    await parentTurn(
      'succeeded',
      'Half done.\nLeft it in the working tree.\nNeeds you: which schema?\n\nChecks for Bolt: tests passed',
    );

    await onePass();

    expect(sentIds()).toEqual([first]);
    expect((await stored(held)).post.afterPostId).toBe(first);
    expect(requestState((await stored(first)).facts!).state).toBe('needs_you');
  });

  it.each([
    ['failed', 'failed', "@api's turn failed", "Waiting: @api's turn failed"],
    ['outcome_unknown', 'failed', "@api's turn was interrupted", "Waiting: @api's turn failed"],
    ['cancelled', 'cancelled', null, 'Waiting for @api'],
  ] as const)(
    'stays held and unsent, and says why, when the other turn ends %s',
    async (status, state, reason, waitingLine) => {
      await onePass();
      await parentTurn(status);

      await onePass();

      expect(sentIds()).toEqual([first]);
      const waiting = await stored(held);
      expect(waiting.post).toMatchObject({ taskId: null, closedState: null, afterPostId: first });
      expect(requestState(waiting.facts!)).toEqual({ state: 'sent', reason: waitingLine });
      expect(heldForRequest(waiting.facts!)).toBe(true);
      expect(requestState((await stored(first)).facts!)).toEqual({ state, reason });
    },
  );

  it('stays held when the user cancels the other request before it runs', async () => {
    await onePass();
    await cancelPost(t.db, first);

    await onePass();

    expect(sentIds()).toEqual([first]);
    expect((await stored(held)).post).toMatchObject({ taskId: null, afterPostId: first });
    expect(requestState((await stored(first)).facts!).state).toBe('cancelled');
  });

  it('is neither released nor sent while the outpost is paused, and goes out on resume', async () => {
    await onePass();
    await parentTurn('succeeded', 'Done.');
    await setPaused(t.db, t.workspaceId, outpostId, true);

    expect(await releaseAnswered(t.db)).toBe(0);
    await onePass();
    expect(sentIds()).toEqual([first]);
    expect((await stored(held)).post.afterPostId).toBe(first);

    await setPaused(t.db, t.workspaceId, outpostId, false);
    await onePass();
    expect(sentIds()).toEqual([first, held]);
  });

  it('is not released while Spark is paused, and goes out once Spark is resumed', async () => {
    await onePass();
    await parentTurn('succeeded', 'Done.');
    await setSparkPaused(t.db, t.workspaceId, true);

    expect(await releaseAnswered(t.db)).toBe(0);
    await onePass();
    expect(sentIds()).toEqual([first]);
    expect((await stored(held)).post.afterPostId).toBe(first);

    await setSparkPaused(t.db, t.workspaceId, false);
    await onePass();
    expect(sentIds()).toEqual([first, held]);
  });

  it('is sent after a restart when the answer arrived while nothing was running', async () => {
    await onePass();
    await parentTurn('succeeded', 'Done.');

    const restarted = startDispatcher({ db: t.db, peer });
    await restarted.close();

    expect(sentIds()).toEqual([first, held]);
  });

  it('is sent once when the release was stored but the send was lost', async () => {
    await onePass();
    await parentTurn('succeeded', 'Done.');
    peer.failing.add(held);
    await onePass();
    expect((await stored(held)).post).toMatchObject({ taskId: null, afterPostId: null });

    peer.failing.clear();
    await onePass();
    await onePass();

    expect(sentIds()).toEqual([first, held, held]);
    expect((await stored(held)).post.taskId).not.toBeNull();
  });

  it('is released once however many wakes arrive together', async () => {
    await onePass();
    await parentTurn('succeeded', 'Done.');

    const counts = await Promise.all([1, 2, 3, 4].map(() => releaseAnswered(t.db)));
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);

    const dispatcher = startDispatcher({ db: t.db, peer });
    for (let burst = 0; burst < 5; burst += 1) dispatcher.changed(changed);
    await eventually(async () => peer.sent.length === 2);
    dispatcher.changed(changed);
    await dispatcher.close();
    expect(sentIds()).toEqual([first, held]);
  });

  it('releases a chain one answer at a time', async () => {
    const [last] = await insertPosts(t.db, [storyRequest(lead, 'lead', held)]);
    await onePass();
    await parentTurn('succeeded', 'Done.');

    await onePass();

    expect(sentIds()).toEqual([first, held]);
    expect((await stored(last!.id)).post).toMatchObject({ taskId: null, afterPostId: held });
  });
});
