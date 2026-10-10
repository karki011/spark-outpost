import type { RequestFacts } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { released } from '../src/outposts/dependency-release.ts';
import type { StoredPost } from '../src/outposts/ports.ts';

const PARENT = '11111111-1111-4111-8111-111111111111';

function held(over: Partial<StoredPost> = {}): StoredPost {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    outpostId: '33333333-3333-4333-8333-333333333333',
    kind: 'request',
    body: 'Build the web part.',
    fromUser: false,
    fromConversationId: '44444444-4444-4444-8444-444444444444',
    fromRunId: null,
    requestHash: null,
    waits: false,
    fromHandle: 'lead',
    toHandle: 'web',
    toConversationId: '55555555-5555-4555-8555-555555555555',
    guest: false,
    batchId: null,
    taskId: null,
    runId: null,
    closedState: null,
    closedReason: null,
    closedAt: null,
    observed: [],
    answerSeenAt: null,
    pinnedAt: null,
    createdAt: '2026-10-09T10:00:00.000Z',
    attachmentIds: [],
    opening: true,
    afterPostId: PARENT,
    userStarted: true,
    ...over,
  };
}

function parent(over: Partial<RequestFacts> = {}): RequestFacts {
  return {
    toHandle: 'api',
    closedState: null,
    closedReason: null,
    sent: true,
    queued: false,
    runStatus: 'succeeded',
    runNeedsYou: null,
    paused: false,
    held: null,
    chatDeleted: false,
    waitingOn: null,
    ...over,
  };
}

describe('releasing a held request', () => {
  it('releases it when the request it waits on is answered', () => {
    expect(released(held(), parent())).toBe(true);
  });

  it.each([
    ['not sent yet', parent({ sent: false, runStatus: null })],
    ['queued in the chat', parent({ queued: true, runStatus: null })],
    ['queued as a run', parent({ runStatus: 'queued' })],
    ['working', parent({ runStatus: 'running' })],
    ['waiting for an approval', parent({ runStatus: 'awaiting_approval' })],
    ['asking the user', parent({ runNeedsYou: 'Needs you: which schema?' })],
  ])('keeps it held while the other request is %s', (_name, facts) => {
    expect(released(held(), facts)).toBe(false);
  });

  it.each([
    ['failed', parent({ runStatus: 'failed' })],
    ['was interrupted by a restart', parent({ runStatus: 'outcome_unknown' })],
    ['was stopped', parent({ runStatus: 'cancelled' })],
    ['was cancelled before it ran', parent({ closedState: 'cancelled', runStatus: null })],
    ['was not delivered', parent({ closedState: 'rejected', runStatus: null })],
    ['was closed after its answer', parent({ closedState: 'cancelled' })],
    ['went to a chat that was deleted', parent({ chatDeleted: true })],
  ])('keeps it held when the other request %s', (_name, facts) => {
    expect(released(held(), facts)).toBe(false);
  });

  it('keeps it held while the outpost is paused, even after the answer', () => {
    expect(released(held(), parent({ paused: true }))).toBe(false);
  });

  it('keeps it held when what it waits on is not a request', () => {
    expect(released(held(), null)).toBe(false);
  });

  it('never releases a request that was sent, closed, or is not a request', () => {
    expect(released(held({ taskId: PARENT }), parent())).toBe(false);
    expect(released(held({ closedState: 'cancelled' }), parent())).toBe(false);
    expect(released(held({ kind: 'note' }), parent())).toBe(false);
  });

  it('has nothing to release for a request that waits on nothing', () => {
    expect(released(held({ afterPostId: null }), parent())).toBe(false);
  });
});
