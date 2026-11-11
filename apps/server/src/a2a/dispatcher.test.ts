import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeerAgent, StoredPost } from '../outposts/ports.ts';
import type { Db } from '../persistence/db.ts';
import { unsentRequests } from '../persistence/outpost-posts.ts';
import { dispatchUnsent } from './dispatcher.ts';

vi.mock('../persistence/outpost-posts.ts', () => ({ unsentRequests: vi.fn() }));

const db = {} as Db;

function post(id: string, toConversationId: string | null): StoredPost {
  return {
    id,
    outpostId: 'outpost',
    kind: 'request',
    body: `Request ${id}`,
    fromUser: true,
    fromConversationId: null,
    fromRunId: null,
    requestHash: null,
    waits: false,
    fromHandle: null,
    toHandle: toConversationId,
    toConversationId,
    batchId: null,
    taskId: null,
    runId: null,
    closedState: null,
    closedReason: null,
    closedAt: null,
    observed: [],
    answerSeenAt: null,
    pinnedAt: null,
    createdAt: '2026-10-25T00:00:00Z',
    attachmentIds: [],
    opening: false,
    afterPostId: null,
    userStarted: true,
    agentStarted: false,
  };
}

function peer(): PeerAgent {
  return {
    send: vi.fn<PeerAgent['send']>(async (request) => ({
      accepted: true,
      task: { taskId: request.postId, state: 'sent', reason: null },
    })),
    get: vi.fn(),
    cancel: vi.fn(),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('independent outpost delivery', () => {
  it('delivers to another chat while one waits, preserving order within each chat', async () => {
    vi.mocked(unsentRequests).mockResolvedValue([
      post('a1', 'a'),
      post('a2', 'a'),
      post('b1', 'b'),
      post('b2', 'b'),
    ]);
    const recipient = peer();
    const blocked = deferred();
    const otherDelivered = deferred();
    const attempted: string[] = [];
    vi.mocked(recipient.send).mockImplementation(async (request) => {
      attempted.push(request.postId);
      if (request.postId === 'a1') await blocked.promise;
      if (request.postId === 'b2') otherDelivered.resolve();
      return {
        accepted: true,
        task: { taskId: request.postId, state: 'sent', reason: null },
      };
    });

    const delivering = dispatchUnsent(db, recipient);
    try {
      await otherDelivered.promise;
      expect(attempted).toEqual(['a1', 'b1', 'b2']);
    } finally {
      blocked.resolve();
    }
    expect(await delivering).toBe(4);
    expect(attempted).toEqual(['a1', 'b1', 'b2', 'a2']);
    expect(recipient.send).toHaveBeenCalledWith({
      postId: 'a2',
      outpostId: 'outpost',
      toConversationId: 'a',
      body: 'Request a2',
    });
  });

  it('continues after a failed delivery and counts only completed sends', async () => {
    vi.mocked(unsentRequests).mockResolvedValue([
      post('broken', 'a'),
      post('next', 'a'),
      post('other', 'b'),
      post('deleted', null),
    ]);
    const recipient = peer();
    vi.mocked(recipient.send).mockRejectedValueOnce(new Error('Unavailable'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await dispatchUnsent(db, recipient)).toBe(2);
    expect(vi.mocked(recipient.send).mock.calls.map(([request]) => request.postId)).toEqual([
      'broken',
      'other',
      'next',
    ]);
    expect(logged).toHaveBeenCalledWith('Outpost request broken was not sent (Error).');
  });

  it('does not send anything when no requests remain', async () => {
    vi.mocked(unsentRequests).mockResolvedValue([]);
    const recipient = peer();
    expect(await dispatchUnsent(db, recipient)).toBe(0);
    expect(recipient.send).not.toHaveBeenCalled();
  });
});
