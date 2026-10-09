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
  attachmentIds: [],
  opening: false,
  afterPostId: null,
  userStarted: false,
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
  held: null,
  chatDeleted: false,
  waitingOn: null,
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

  it('counts the files of a request and carries none of their ids', () => {
    const found: PostWithFacts = {
      post: { ...stored, attachmentIds: [stored.id, stored.outpostId] },
      facts,
    };
    const view = toOutpostPost(found, null);
    expect(view.files).toBe(2);
    expect(outpostPostSchema.strict().parse(view)).toEqual(view);
  });

  it('draws a join line from the current facts in place of the stored words', () => {
    const chatId = '33333333-3333-4333-8333-333333333333';
    const line: PostWithFacts = {
      post: {
        ...stored,
        kind: 'notice',
        body: '@api joined',
        fromUser: false,
        fromConversationId: chatId,
        fromHandle: 'api',
        toHandle: null,
        toConversationId: null,
      },
      facts: null,
    };
    const intro = { conversationId: chatId, task: 'Task: Add the filter.' };
    expect(toOutpostPost(line, null, { body: '@backend joined · api', intro })).toMatchObject({
      body: '@backend joined · api',
      intro,
    });
    expect(toOutpostPost(line, null)).toMatchObject({ body: '@api joined', intro: null });
  });

  it('keeps the questions a request was asked and the user’s answers', () => {
    const found: PostWithFacts = {
      post: { ...stored, taskId: stored.id, runId: stored.id },
      facts: { ...facts, sent: true, runStatus: 'running' },
    };
    const exchanges = [{ question: 'Needs you: v1 or v2?', answer: 'v2' }];

    expect(toOutpostPost(found, null, null, exchanges)).toMatchObject({
      state: 'working',
      exchanges,
    });
    expect(toOutpostPost(found, null).exchanges).toEqual([]);
  });

  it('gives a note no state, reason or answer', () => {
    const note: PostWithFacts = {
      post: { ...stored, kind: 'note', toHandle: null, toConversationId: null },
      facts: null,
    };
    const exchanges = [{ question: 'Needs you: v1 or v2?', answer: 'v2' }];

    expect(toOutpostPost(note, answer, null, exchanges)).toMatchObject({
      state: null,
      reason: null,
      answer: null,
      exchanges: [],
    });
  });
});
