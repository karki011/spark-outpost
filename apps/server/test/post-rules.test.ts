import { describe, expect, it } from 'vitest';
import type { OutpostMember, PostAddress } from '@spark-outpost/contracts';
import type { RequestAuthor } from '../src/outposts/ports.ts';
import {
  ALL_NOT_AVAILABLE,
  AUTHOR_NOT_MEMBER,
  CANNOT_ASK_SELF,
  CHATS_CANNOT_ASK_ALL,
  GUESTS_NOT_AVAILABLE,
  OUTPOST_PAUSED,
  planPost,
  REQUEST_STARTED_TURN,
} from '../src/outposts/post-rules.ts';

const FE = '11111111-1111-4111-8111-111111111111';
const API = '22222222-2222-4222-8222-222222222222';
const GUEST = '33333333-3333-4333-8333-333333333333';
const RUN = '55555555-5555-4555-8555-555555555555';
const OUTPOST = '44444444-4444-4444-8444-444444444444';

const members: OutpostMember[] = [
  { conversationId: FE, handle: 'fe', position: 1, joinedAt: '2026-10-09T10:00:00.000Z' },
  { conversationId: API, handle: 'api', position: 2, joinedAt: '2026-10-09T10:01:00.000Z' },
];
const user: RequestAuthor = { kind: 'user' };
const open = { id: OUTPOST, paused: false };
const paused = { id: OUTPOST, paused: true };

function chatAuthor(startedByRequest: boolean, conversationId = FE): RequestAuthor {
  return { kind: 'chat', conversationId, handle: 'fe', runId: RUN, startedByRequest };
}

const toApi: PostAddress = { kind: 'request', to: 'api', body: 'What is the response shape?' };
const note: PostAddress = { kind: 'note', body: 'Shipping Friday.' };

describe('what the user may post', () => {
  it('turns a request to a member into one row from the user, addressed to that chat', () => {
    expect(planPost(user, toApi, members, open)).toEqual({
      kind: 'plan',
      posts: [
        {
          outpostId: OUTPOST,
          kind: 'request',
          body: 'What is the response shape?',
          fromUser: true,
          toHandle: 'api',
          toConversationId: API,
        },
      ],
    });
  });

  it('turns unaddressed text into a note that names no chat', () => {
    expect(planPost(user, note, members, open)).toEqual({
      kind: 'plan',
      posts: [{ outpostId: OUTPOST, kind: 'note', body: 'Shipping Friday.', fromUser: true }],
    });
  });

  it('lets the user post a request and a note while the outpost is paused', () => {
    expect(planPost(user, toApi, members, paused).kind).toBe('plan');
    expect(planPost(user, note, members, paused).kind).toBe('plan');
  });

  it('refuses a handle that is not a member', () => {
    expect(planPost(user, { kind: 'request', to: 'docs', body: 'Hi' }, members, open)).toEqual({
      kind: 'refusal',
      message: '@docs is not in this outpost.',
    });
    expect(planPost(user, toApi, [], open).kind).toBe('refusal');
  });

  it('refuses @all for now', () => {
    expect(planPost(user, { kind: 'all', body: 'Rebase on main.' }, members, open)).toEqual({
      kind: 'refusal',
      message: ALL_NOT_AVAILABLE,
    });
  });

  it('refuses a guest for now, whatever the text is', () => {
    for (const address of [toApi, note]) {
      expect(planPost(user, address, members, open, GUEST)).toEqual({
        kind: 'refusal',
        message: GUESTS_NOT_AVAILABLE,
      });
    }
  });
});

describe('what a chat may post', () => {
  const asking = chatAuthor(false);
  const answering = chatAuthor(true);

  function refused(...args: Parameters<typeof planPost>): string | null {
    const plan = planPost(...args);
    return plan.kind === 'refusal' ? plan.message : null;
  }

  it('turns a request to another member into one row from that chat and its turn', () => {
    expect(planPost(asking, toApi, members, open)).toEqual({
      kind: 'plan',
      posts: [
        {
          outpostId: OUTPOST,
          kind: 'request',
          body: 'What is the response shape?',
          fromUser: false,
          fromConversationId: FE,
          fromHandle: 'fe',
          fromRunId: RUN,
          toHandle: 'api',
          toConversationId: API,
        },
      ],
    });
  });

  it('refuses a request from a turn another chat started, and still takes its note', () => {
    expect(refused(answering, toApi, members, open)).toBe(REQUEST_STARTED_TURN);
    expect(refused(answering, { kind: 'all', body: 'Rebase.' }, members, open)).toBe(
      REQUEST_STARTED_TURN,
    );
    expect(planPost(answering, note, members, open)).toEqual({
      kind: 'plan',
      posts: [
        {
          outpostId: OUTPOST,
          kind: 'note',
          body: 'Shipping Friday.',
          fromUser: false,
          fromConversationId: FE,
          fromHandle: 'fe',
          fromRunId: RUN,
        },
      ],
    });
  });

  it('refuses a request to itself, to @all and to a chat outside the outpost', () => {
    expect(refused(asking, { kind: 'request', to: 'fe', body: 'Hi' }, members, open)).toBe(
      CANNOT_ASK_SELF,
    );
    expect(refused(asking, { kind: 'all', body: 'Rebase.' }, members, open)).toBe(
      CHATS_CANNOT_ASK_ALL,
    );
    expect(refused(asking, { kind: 'request', to: 'docs', body: 'Hi' }, members, open)).toBe(
      '@docs is not in this outpost.',
    );
    expect(refused(asking, toApi, members, open, GUEST)).toBe(GUESTS_NOT_AVAILABLE);
  });

  it('refuses a request while the outpost is paused, and takes a note', () => {
    expect(refused(asking, toApi, members, paused)).toBe(OUTPOST_PAUSED);
    expect(planPost(asking, note, members, paused).kind).toBe('plan');
  });

  it('refuses every post from a chat that is not a member, using the stored handle otherwise', () => {
    const outsider = chatAuthor(false, GUEST);
    for (const address of [toApi, note]) {
      expect(refused(outsider, address, members, open)).toBe(AUTHOR_NOT_MEMBER);
    }
    const renamed: RequestAuthor = { ...chatAuthor(false), handle: 'stale' } as RequestAuthor;
    const plan = planPost(renamed, note, members, open);
    expect(plan.kind === 'plan' && plan.posts[0]?.fromHandle).toBe('fe');
  });
});
