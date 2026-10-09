import { describe, expect, it } from 'vitest';
import { needsYouCount, pinnedNotes, threadItems } from './outpost-thread.ts';
import type { OutpostPost } from './outposts.ts';

const OUTPOST = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const BATCH = '5f0e0d0c-1a2b-4c3d-8e9f-001122334455';

function at(minute: number): string {
  return `2026-10-09T10:${String(minute).padStart(2, '0')}:00.000Z`;
}

function post(number: number, extra: Partial<OutpostPost> = {}): OutpostPost {
  return {
    id: `${String(number).padStart(8, '0')}-1a2b-4c3d-8e9f-001122334455`,
    outpostId: OUTPOST,
    kind: 'note',
    body: `Post ${number}`,
    fromUser: true,
    fromConversationId: null,
    fromHandle: null,
    toConversationId: null,
    toHandle: null,
    guest: false,
    waits: false,
    batchId: null,
    taskId: null,
    runId: null,
    pinnedAt: null,
    createdAt: at(number),
    state: null,
    reason: null,
    answer: null,
    ...extra,
  };
}

function request(number: number, extra: Partial<OutpostPost> = {}): OutpostPost {
  return post(number, { kind: 'request', toHandle: 'api', state: 'sent', ...extra });
}

describe('threadItems', () => {
  it('draws each post as an item of its own kind', () => {
    const notice = post(1, { kind: 'notice', fromUser: false });
    const asked = request(2);
    const note = post(3);
    expect(threadItems([notice, asked, note])).toEqual([
      { kind: 'notice', post: notice },
      { kind: 'request', post: asked },
      { kind: 'note', post: note },
    ]);
  });

  it('orders posts by when they were written', () => {
    const items = threadItems([post(3), request(1), post(2, { kind: 'notice' })]);
    expect(items.map((item) => item.kind)).toEqual(['request', 'notice', 'note']);
  });

  it('keeps the given order for posts written at the same moment', () => {
    const first = post(1, { createdAt: at(5) });
    const second = post(2, { createdAt: at(5) });
    const third = post(3, { createdAt: at(5) });
    const posts = threadItems([second, third, first]).map((item) =>
      item.kind === 'batch' ? null : item.post.id,
    );
    expect(posts).toEqual([second.id, third.id, first.id]);
  });

  it('does not change the list it is given', () => {
    const posts = [post(2), post(1)];
    threadItems(posts);
    expect(posts.map((given) => given.body)).toEqual(['Post 2', 'Post 1']);
  });

  it('draws requests that share a batch as separate requests', () => {
    const items = threadItems([
      request(1, { batchId: BATCH, toHandle: 'fe' }),
      request(2, { batchId: BATCH, toHandle: 'api' }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['request', 'request']);
  });

  it('returns nothing for an empty thread', () => {
    expect(threadItems([])).toEqual([]);
  });
});

describe('pinnedNotes', () => {
  it('returns pinned notes in thread order', () => {
    const late = post(4, { pinnedAt: at(5) });
    const early = post(2, { pinnedAt: at(9) });
    expect(pinnedNotes([late, post(3), early, request(1)])).toEqual([early, late]);
  });

  it('leaves out posts that are not notes', () => {
    const pinned = [request(1, { pinnedAt: at(2) }), post(2, { kind: 'notice', pinnedAt: at(3) })];
    expect(pinnedNotes(pinned)).toEqual([]);
  });

  it('returns nothing when no note is pinned', () => {
    expect(pinnedNotes([post(1), request(2)])).toEqual([]);
  });
});

describe('needsYouCount', () => {
  it('counts requests that read Needs you', () => {
    const posts = [
      request(1, { state: 'needs_you' }),
      request(2, { state: 'working' }),
      request(3, { state: 'needs_you' }),
      request(4, { state: 'answered' }),
      request(5, { state: 'failed' }),
      request(6, { state: 'cancelled' }),
      request(7, { state: 'sent' }),
      post(8),
    ];
    expect(needsYouCount(posts)).toBe(2);
  });

  it('counts each request of a batch on its own', () => {
    const posts = [
      request(1, { batchId: BATCH, toHandle: 'fe', state: 'needs_you' }),
      request(2, { batchId: BATCH, toHandle: 'api', state: 'needs_you' }),
    ];
    expect(needsYouCount(posts)).toBe(2);
  });

  it('is zero for an empty thread', () => {
    expect(needsYouCount([])).toBe(0);
  });
});
