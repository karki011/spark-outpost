import { describe, expect, it } from 'vitest';
import { outpostPostSchema, type RequestFacts } from '@spark-outpost/contracts';
import type { PostWithFacts, StoredPost } from '../src/outposts/ports.ts';
import { toOutpostPost } from '../src/outposts/post-view.ts';

const stored: StoredPost = {
  id: '11111111-1111-4111-8111-111111111111',
  outpostId: '22222222-2222-4222-8222-222222222222',
  kind: 'request',
  body: 'What is the shape?',
  fromUser: true,
  fromConversationId: null,
  fromRunId: null,
  requestHash: null,
  waits: false,
  fromHandle: null,
  toHandle: 'api',
  toConversationId: '33333333-3333-4333-8333-333333333333',
  guest: false,
  batchId: null,
  taskId: null,
  runId: null,
  closedState: null,
  closedReason: null,
  closedAt: null,
  observed: [{ source: 'web_page', label: 'example.com' }],
  answerSeenAt: null,
  pinnedAt: null,
  createdAt: '2026-10-09T10:00:00.000Z',
};

const facts: RequestFacts = {
  toHandle: 'api',
  closedState: null,
  closedReason: null,
  sent: false,
  queued: false,
  runStatus: null,
  runNeedsYou: null,
  paused: false,
  held: false,
  chatDeleted: false,
};

const answer = { text: 'A list of orders.', branch: null, changes: [], pullRequests: [] };

describe('the post the outpost page receives', () => {
  it('carries the derived state and reason of a request and none of the stored-only fields', () => {
    const view = toOutpostPost({ post: stored, facts }, null);
    expect(view).toMatchObject({ state: 'sent', reason: 'Not sent yet', answer: null });
    expect(outpostPostSchema.strict().parse(view)).toEqual(view);
  });

  it('threads the answer under an answered request', () => {
    const found: PostWithFacts = {
      post: { ...stored, taskId: stored.id, runId: stored.id },
      facts: { ...facts, sent: true, runStatus: 'succeeded' },
    };
    expect(toOutpostPost(found, answer)).toMatchObject({ state: 'answered', answer });
  });

  it('gives a note no state, reason or answer', () => {
    const note: PostWithFacts = {
      post: { ...stored, kind: 'note', toHandle: null, toConversationId: null },
      facts: null,
    };
    expect(toOutpostPost(note, answer)).toMatchObject({ state: null, reason: null, answer: null });
  });
});
