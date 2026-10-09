import type { AppEvent } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchUnsent, sendable, startDispatcher } from '../src/a2a/dispatcher.ts';
import type {
  OutboundRequest,
  PeerAgent,
  SendOutcome,
  StoredPost,
} from '../src/outposts/ports.ts';
import { acceptTask } from '../src/persistence/outpost-tasks.ts';
import {
  memberChat,
  outpostRow,
  postColumns,
  requestRow,
  standInUnsentRequests,
} from './a2a-stand-ins.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let api: string;

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await outpostRow(t);
  api = await memberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

interface FakePeer extends PeerAgent {
  sent: OutboundRequest[];
  failing: Set<string>;
}

function acceptingPeer(): FakePeer {
  const sent: OutboundRequest[] = [];
  const failing = new Set<string>();
  return {
    sent,
    failing,
    async send(request): Promise<SendOutcome> {
      if (failing.has(request.postId)) throw new Error('connection refused');
      sent.push(request);
      const outcome = await acceptTask(t.db, request.toConversationId, {
        messageId: request.postId,
        contextId: request.outpostId,
        text: request.body,
      });
      if (outcome.kind === 'refused') throw new Error(outcome.why);
      return {
        accepted: outcome.kind === 'accepted',
        task: { taskId: outcome.taskId, state: 'sent', reason: null },
      };
    },
    get: () => Promise.reject(new Error('The dispatcher never reads a task.')),
    cancel: () => Promise.reject(new Error('The dispatcher never cancels a task.')),
  };
}

function deps(peer: PeerAgent) {
  return { db: t.db, peer, unsentRequests: standInUnsentRequests };
}

function request(body: string, toConversationId = api, toHandle = 'api') {
  return requestRow(t.db, { outpostId, toConversationId, toHandle, body });
}

const changed: AppEvent = { kind: 'outpost_changed', conversationId: null, runId: null };

describe('sending unsent requests', () => {
  it('sends each unsent request once, oldest first, with its row’s text', async () => {
    const web = await memberChat(t, outpostId, 'web');
    const first = await request('first');
    const second = await request('second', web, 'web');
    const third = await request('third');
    const peer = acceptingPeer();

    expect(await dispatchUnsent(deps(peer))).toBe(3);

    expect(peer.sent).toEqual([
      { postId: first, outpostId, toConversationId: api, body: 'first' },
      { postId: second, outpostId, toConversationId: web, body: 'second' },
      { postId: third, outpostId, toConversationId: api, body: 'third' },
    ]);
    expect(await dispatchUnsent(deps(peer))).toBe(0);
    expect(peer.sent).toHaveLength(3);
  });

  it('holds the requests of a paused outpost and sends them once it resumes', async () => {
    const other = await outpostRow(t, 'Other');
    const docs = await memberChat(t, other, 'docs');
    const held = await request('held');
    const free = await requestRow(t.db, {
      outpostId: other,
      toConversationId: docs,
      toHandle: 'docs',
    });
    await t.db.query('UPDATE outposts SET paused_at = now() WHERE id = $1', [outpostId]);
    const peer = acceptingPeer();

    expect(await dispatchUnsent(deps(peer))).toBe(1);
    expect(peer.sent.map((sent) => sent.postId)).toEqual([free]);
    expect((await postColumns(t.db, held))?.task_id).toBeNull();

    await t.db.query('UPDATE outposts SET paused_at = NULL WHERE id = $1', [outpostId]);
    expect(await dispatchUnsent(deps(peer))).toBe(1);
    expect(peer.sent.map((sent) => sent.postId)).toEqual([free, held]);
  });

  it('leaves a request that could not be sent for the next pass and sends the rest', async () => {
    const broken = await request('broken');
    const fine = await request('fine');
    const peer = acceptingPeer();
    peer.failing.add(broken);

    expect(await dispatchUnsent(deps(peer))).toBe(1);
    expect(peer.sent.map((sent) => sent.postId)).toEqual([fine]);
    expect((await postColumns(t.db, broken))?.task_id).toBeNull();

    peer.failing.clear();
    expect(await dispatchUnsent(deps(peer))).toBe(1);
    expect(peer.sent.map((sent) => sent.postId)).toEqual([fine, broken]);
  });

  it('does not send a request that was closed, or one whose chat was deleted', async () => {
    const closed = await request('closed');
    await t.db.query(
      `UPDATE outpost_posts SET closed_state = 'cancelled', closed_at = now() WHERE id = $1`,
      [closed],
    );
    const web = await memberChat(t, outpostId, 'web');
    await request('orphan', web, 'web');
    await t.db.query('DELETE FROM conversations WHERE id = $1', [web]);
    const peer = acceptingPeer();

    expect(await dispatchUnsent(deps(peer))).toBe(0);
    expect(peer.sent).toEqual([]);
  });

  it('counts a request the chat rejected as sent and does not send it again', async () => {
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [api]);
    const postId = await request('to an archived chat');
    const peer = acceptingPeer();

    expect(await dispatchUnsent(deps(peer))).toBe(1);
    expect(await dispatchUnsent(deps(peer))).toBe(0);
    expect((await postColumns(t.db, postId))?.closed_state).toBe('rejected');
  });

  it('decides what is sendable from the row alone', () => {
    const post = { kind: 'request', taskId: null, closedState: null, toConversationId: api };
    const row = { ...post, outpostId } as StoredPost;
    expect(sendable(row, new Set())).toBe(true);
    expect(sendable(row, new Set([outpostId]))).toBe(false);
    expect(sendable({ ...row, taskId: outpostId }, new Set())).toBe(false);
    expect(sendable({ ...row, kind: 'note' }, new Set())).toBe(false);
  });
});

describe('the running dispatcher', () => {
  it('sends what was left unsent when it starts', async () => {
    const postId = await request('written before a restart');
    const peer = acceptingPeer();
    const dispatcher = startDispatcher(deps(peer));
    await dispatcher.close();
    expect(peer.sent.map((sent) => sent.postId)).toEqual([postId]);
  });

  it('sends a new request when the outpost changes and ignores other changes', async () => {
    const peer = acceptingPeer();
    const dispatcher = startDispatcher(deps(peer));
    const postId = await request('new');
    dispatcher.changed({ kind: 'run', conversationId: api, runId: null });
    dispatcher.changed(changed);
    await eventually(async () => peer.sent.length === 1);
    await dispatcher.close();
    expect(peer.sent.map((sent) => sent.postId)).toEqual([postId]);
  });

  it('never sends one request twice when changes arrive during a pass', async () => {
    const peer = acceptingPeer();
    const first = await request('one');
    const dispatcher = startDispatcher(deps(peer));
    const second = await request('two');
    for (let burst = 0; burst < 5; burst += 1) dispatcher.changed(changed);
    await eventually(async () => peer.sent.length === 2);
    dispatcher.changed(changed);
    await dispatcher.close();
    expect(peer.sent.map((sent) => sent.postId).sort()).toEqual([first, second].sort());
  });

  it('sends nothing after it is closed', async () => {
    const peer = acceptingPeer();
    const dispatcher = startDispatcher(deps(peer));
    await dispatcher.close();
    await request('late');
    dispatcher.changed(changed);
    await dispatcher.close();
    expect(peer.sent).toEqual([]);
  });
});
