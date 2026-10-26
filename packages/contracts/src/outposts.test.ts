import { describe, expect, it } from 'vitest';
import { parseAppEvent } from './app-events.ts';
import { conversationSummarySchema } from './conversations.ts';
import { queuedMessageSchema } from './crew-messages.ts';
import {
  createOutpostRequestSchema,
  createOutpostResponseSchema,
  createPostRequestSchema,
  memberRequestSchema,
  outpostDetailSchema,
  outpostPostSchema,
  outpostHandleSchema,
  pinPostRequestSchema,
  rejectReasonSchema,
  requestFactsSchema,
  requestStateSchema,
  startMemberChatId,
  updateOutpostRequestSchema,
  type DerivedRequestState,
  type HandleProblem,
  type NeedsYouCount,
  type OutpostDetail,
  type ParseAddress,
  type PinnedNotes,
  type RequestStateOf,
  type SuggestHandle,
  type ThreadItems,
} from './outposts.ts';
import { runSchema } from './runs.ts';
import { SPARK_TEXT_MAX } from './spark-actions.ts';

const OUTPOST = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const FRONTEND = '1f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const BACKEND = '2f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const POST = '3f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const RUN = '4f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const AT = '2026-10-09T10:00:00.000Z';

const detail: OutpostDetail = {
  outpost: {
    id: OUTPOST,
    name: 'Orders launch',
    pausedAt: null,
    instructions: '',
    createdAt: AT,
    updatedAt: AT,
    members: [
      { conversationId: FRONTEND, handle: 'fe', position: 1, joinedAt: AT },
      { conversationId: BACKEND, handle: 'api', position: 2, joinedAt: AT },
    ],
    needsYou: 0,
  },
  posts: [
    {
      id: POST,
      outpostId: OUTPOST,
      kind: 'request',
      body: 'What does the orders response look like?',
      fromUser: false,
      fromSpark: false,
      fromConversationId: FRONTEND,
      fromRunId: null,
      fromHandle: 'fe',
      userStarted: false,
      agentStarted: false,
      held: false,
      toConversationId: BACKEND,
      toHandle: 'api',
      guest: false,
      waits: true,
      batchId: null,
      taskId: RUN,
      runId: RUN,
      pinnedAt: null,
      createdAt: AT,
      state: 'answered',
      reason: null,
      answer: {
        text: 'An array of orders.',
        branch: 'spark/orders-0a1b2c3d',
        changes: ['src/orders.ts'],
        pullRequests: ['https://github.com/acme/api/pull/7'],
      },
      exchanges: [{ question: 'Needs you: which fields?', answer: 'All of them.' }],
      files: 0,
      intro: null,
    },
  ],
  stories: [],
};

describe('outpost schemas', () => {
  it('reads a post written before exchanges existed as having none', () => {
    const earlier = { ...detail.posts[0], exchanges: undefined };

    expect(outpostPostSchema.parse(earlier).exchanges).toEqual([]);
  });

  it('reads back an outpost with a request and its answer unchanged', () => {
    expect(outpostDetailSchema.parse(JSON.parse(JSON.stringify(detail)))).toEqual(detail);
  });

  it('names the six request states and no others', () => {
    expect(requestStateSchema.options).toEqual([
      'sent',
      'working',
      'needs_you',
      'answered',
      'failed',
      'cancelled',
    ]);
    expect(requestStateSchema.safeParse('rejected').success).toBe(false);
  });

  it('accepts handles of two to 32 lower-case characters that start with a letter', () => {
    for (const handle of ['fe', 'api', 'docs-2', 'a234567890123456', `a${'2'.repeat(31)}`]) {
      expect(outpostHandleSchema.safeParse(handle).success, handle).toBe(true);
    }
    for (const handle of ['', 'a', 'FE', '2fe', '-fe', 'fe_1', '@fe', `a${'2'.repeat(32)}`]) {
      expect(outpostHandleSchema.safeParse(handle).success, handle).toBe(false);
    }
  });

  it('trims an outpost name and refuses an empty or overlong one', () => {
    const request = { id: OUTPOST, name: '  Orders launch ', members: [] };
    expect(createOutpostRequestSchema.parse(request).name).toBe('Orders launch');
    expect(createOutpostRequestSchema.safeParse({ ...request, name: '  ' }).success).toBe(false);
    expect(createOutpostRequestSchema.safeParse({ ...request, name: 'x'.repeat(61) }).success).toBe(
      false,
    );
    expect(memberRequestSchema.safeParse({ conversationId: 'fe', handle: 'fe' }).success).toBe(
      false,
    );
  });

  it('takes an existing chat or a new one as a member, each with an optional first message', () => {
    const existing = { conversationId: FRONTEND, handle: 'fe' };
    const fresh = {
      new: {
        conversationId: BACKEND,
        projectId: RUN,
        provider: 'codex',
        model: null,
        agentMode: 'agent',
      },
      handle: 'api',
      firstMessage: { id: POST, text: ' Add the filter. ' },
    };
    const parsed = createOutpostRequestSchema.parse({
      id: OUTPOST,
      name: 'Orders launch',
      members: [existing, fresh],
    });

    expect(parsed.members.map(startMemberChatId)).toEqual([FRONTEND, BACKEND]);
    expect(parsed.members[1]?.firstMessage).toEqual({
      id: POST,
      text: 'Add the filter.',
      attachmentIds: [],
    });
    for (const broken of [
      { ...fresh, new: { ...fresh.new, projectId: undefined } },
      { ...fresh, new: { ...fresh.new, provider: 'nobody' } },
      { ...fresh, firstMessage: { id: POST, text: '  ' } },
      { ...fresh, firstMessage: { text: 'No id' } },
      { handle: 'api' },
    ]) {
      const request = { id: OUTPOST, name: 'Orders launch', members: [broken] };
      expect(createOutpostRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it('reads a start result with the members that could not be added', () => {
    expect(createOutpostResponseSchema.parse(detail).failed).toEqual([]);
    const failed = [{ conversationId: BACKEND, handle: 'api', message: 'Connect this provider.' }];
    expect(createOutpostResponseSchema.parse({ ...detail, failed }).failed).toEqual(failed);
  });

  it('refuses an update that changes nothing', () => {
    expect(updateOutpostRequestSchema.safeParse({}).success).toBe(false);
    expect(updateOutpostRequestSchema.parse({ paused: true })).toEqual({ paused: true });
    expect(pinPostRequestSchema.parse({ pinned: false })).toEqual({ pinned: false });
  });

  it('caps post text and needs a client id', () => {
    expect(createPostRequestSchema.parse({ id: POST, text: ' @api ship it ' }).text).toBe(
      '@api ship it',
    );
    expect(createPostRequestSchema.safeParse({ text: '@api ship it' }).success).toBe(false);
    expect(
      createPostRequestSchema.safeParse({ id: POST, text: 'x'.repeat(SPARK_TEXT_MAX + 1) }).success,
    ).toBe(false);
  });

  it('accepts one direct member target without changing text and refuses mixed addressing', () => {
    const request = { id: POST, text: 'where are we', toConversationId: BACKEND };
    expect(createPostRequestSchema.parse(request)).toEqual(request);
    for (const extra of [{ to: [] }, { to: ['api'] }, { guestConversationId: BACKEND }]) {
      expect(createPostRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
    expect(
      createPostRequestSchema.safeParse({ ...request, toConversationId: 'missing' }).success,
    ).toBe(false);
  });

  it('reads the facts a request state is derived from', () => {
    const facts = {
      toHandle: 'api',
      closedState: 'rejected',
      closedReason: rejectReasonSchema.enum.queue_full,
      sent: false,
      queued: false,
      runStatus: null,
      runNeedsYou: null,
      paused: false,
      held: null,
      chatDeleted: false,
      waitingOn: null,
    };
    expect(requestFactsSchema.parse(facts)).toEqual(facts);
    expect(requestFactsSchema.safeParse({ ...facts, closedState: 'answered' }).success).toBe(false);
    expect(requestFactsSchema.safeParse({ ...facts, runStatus: 'working' }).success).toBe(false);
  });

  it('lets the pure rules be written against the agreed signatures', () => {
    const state: DerivedRequestState = { state: 'sent', reason: 'Paused' };
    const rules: {
      handleProblem: HandleProblem;
      suggestHandle: SuggestHandle;
      parseAddress: ParseAddress;
      requestState: RequestStateOf;
      threadItems: ThreadItems;
      pinnedNotes: PinnedNotes;
      needsYouCount: NeedsYouCount;
    } = {
      handleProblem: () => null,
      suggestHandle: (name) => name,
      parseAddress: (text) => ({ kind: 'note', body: text }),
      requestState: () => state,
      threadItems: (posts) => posts.map((post) => ({ kind: 'note', post })),
      pinnedNotes: (posts) => [...posts],
      needsYouCount: (posts) => posts.length,
    };
    expect(rules.threadItems(detail.posts)).toHaveLength(1);
  });
});

describe('outpost fields on existing contracts', () => {
  it('carries an outpost change as an app event', () => {
    const event = {
      kind: 'outpost_changed',
      conversationId: null,
      runId: null,
      outpostId: OUTPOST,
    };
    expect(parseAppEvent(JSON.stringify(event))).toEqual(event);
  });

  it('keeps the outpost optional on a chat, a run and a queued message', () => {
    const outpost = { id: OUTPOST, name: 'Orders launch', handle: 'api' };
    expect(conversationSummarySchema.shape.outpost.parse(outpost)).toEqual(outpost);
    expect(conversationSummarySchema.shape.outpost.parse(undefined)).toBeUndefined();
    const from = {
      postId: POST,
      outpostId: OUTPOST,
      outpostName: 'Orders launch',
      fromHandle: null,
      fromUser: true,
      fromSpark: false,
      userStarted: false,
      agentStarted: false,
    };
    expect(runSchema.shape.outpost.parse(from)).toEqual(from);
    expect(runSchema.shape.outpost.parse(undefined)).toBeUndefined();
    const queued = { id: POST, content: 'x', position: 1, continueRunId: null, createdAt: AT };
    expect(queuedMessageSchema.parse(queued)).toEqual(queued);
    expect(queuedMessageSchema.parse({ ...queued, outpostPostId: POST }).outpostPostId).toBe(POST);
  });
});
