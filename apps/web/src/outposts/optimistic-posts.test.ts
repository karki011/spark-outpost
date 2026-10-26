import { describe, expect, it } from 'vitest';
import { optimisticPosts } from './optimistic-posts.ts';
import { API_CHAT, FE_CHAT, detail, postId } from './test-fixtures.ts';

function ids(): () => string {
  let next = 20;
  return () => postId((next += 1));
}

describe('optimisticPosts', () => {
  it('draws a direct request without requiring or interpreting a handle', () => {
    const [drawn] = optimisticPosts(
      detail(),
      { id: postId(7), text: 'where are we', toConversationId: FE_CHAT },
      'now',
    );
    expect(drawn).toMatchObject({
      kind: 'request',
      body: 'where are we',
      toHandle: 'fe',
      toConversationId: FE_CHAT,
      state: 'sent',
    });
    expect(
      optimisticPosts(
        detail(),
        { id: postId(8), text: 'where are we', toConversationId: 'gone' },
        'now',
      ),
    ).toEqual([]);
  });

  it('draws a request to a member as Sent before the server has it', () => {
    const drawn = optimisticPosts(detail(), { id: postId(7), text: '@api add the filter' }, 'now');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      id: postId(7),
      kind: 'request',
      body: 'add the filter',
      fromUser: true,
      toHandle: 'api',
      toConversationId: API_CHAT,
      batchId: null,
      state: 'sent',
      reason: 'Not sent yet',
      createdAt: 'now',
    });
  });

  it('draws one request per chat a message asks, under one batch', () => {
    const text = '@fe draw what @api returns';
    const drawn = optimisticPosts(detail(), { id: postId(7), text }, 'now', ids());
    expect(drawn.map((post) => [post.id, post.toHandle, post.toConversationId, post.body])).toEqual(
      [
        [postId(7), 'fe', FE_CHAT, text],
        [postId(22), 'api', API_CHAT, text],
      ],
    );
    expect(drawn.map((post) => post.batchId)).toEqual([postId(21), postId(21)]);
  });

  it('draws only the chats the sender kept', () => {
    const text = '@fe draw what @api returns';
    const kept = optimisticPosts(detail(), { id: postId(7), text, to: ['api'] }, 'now');
    expect(kept.map((post) => [post.kind, post.toHandle, post.batchId])).toEqual([
      ['request', 'api', null],
    ]);
    const none = optimisticPosts(detail(), { id: postId(7), text, to: [] }, 'now');
    expect(none.map((post) => [post.kind, post.toHandle, post.body])).toEqual([
      ['note', null, text],
    ]);
  });

  it('draws anything else as a note with no state', () => {
    const drawn = optimisticPosts(detail(), { id: postId(7), text: '@nobody hello' }, 'now');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      kind: 'note',
      body: '@nobody hello',
      toHandle: null,
      state: null,
    });
  });

  it('says Paused for a request posted to a paused outpost', () => {
    const paused = detail([], { pausedAt: '2026-10-09T10:30:00.000Z' });
    const [drawn] = optimisticPosts(paused, { id: postId(7), text: '@fe go' }, 'now');
    expect(drawn?.reason).toBe('Paused');
  });
});
