import { describe, expect, it } from 'vitest';
import { requestState } from './outpost-state.ts';
import { requestStateSchema, type RequestFacts } from './outposts.ts';
import { runStatusSchema } from './runs.ts';

function facts(extra: Partial<RequestFacts> = {}): RequestFacts {
  return {
    toHandle: 'api',
    closedState: null,
    closedReason: null,
    sent: true,
    queued: false,
    runStatus: null,
    runNeedsYou: null,
    paused: false,
    held: false,
    chatDeleted: false,
    waitingOn: null,
    ...extra,
  };
}

describe('requestState from the run', () => {
  it('reads a queued run as Sent', () => {
    expect(requestState(facts({ runStatus: 'queued' }))).toEqual({ state: 'sent', reason: null });
  });

  it('reads a running run as Working', () => {
    expect(requestState(facts({ runStatus: 'running' }))).toEqual({
      state: 'working',
      reason: null,
    });
  });

  it('reads a run waiting on an approval card as Needs you', () => {
    expect(requestState(facts({ runStatus: 'awaiting_approval' }))).toEqual({
      state: 'needs_you',
      reason: '@api is waiting for your approval',
    });
  });

  it('reads a succeeded run as Answered', () => {
    expect(requestState(facts({ runStatus: 'succeeded' }))).toEqual({
      state: 'answered',
      reason: null,
    });
  });

  it('reads a succeeded run that ends with Needs you as Needs you, with its question', () => {
    expect(
      requestState(facts({ runStatus: 'succeeded', runNeedsYou: 'Needs you: v1 or v2 shape?' })),
    ).toEqual({ state: 'needs_you', reason: 'v1 or v2 shape?' });
    expect(requestState(facts({ runStatus: 'succeeded', runNeedsYou: 'pick a shape' }))).toEqual({
      state: 'needs_you',
      reason: 'pick a shape',
    });
    expect(requestState(facts({ runStatus: 'succeeded', runNeedsYou: 'Needs you: ' }))).toEqual({
      state: 'needs_you',
      reason: null,
    });
  });

  it('ignores a Needs you line on a run that did not succeed', () => {
    expect(requestState(facts({ runStatus: 'running', runNeedsYou: 'Needs you: x' })).state).toBe(
      'working',
    );
  });

  it('reads a failed run as Failed', () => {
    expect(requestState(facts({ runStatus: 'failed' }))).toEqual({
      state: 'failed',
      reason: "@api's turn failed",
    });
  });

  it('reads a run with an unknown outcome as Failed', () => {
    expect(requestState(facts({ runStatus: 'outcome_unknown' }))).toEqual({
      state: 'failed',
      reason: "@api's turn was interrupted",
    });
  });

  it('reads a cancelled run as Cancelled', () => {
    expect(requestState(facts({ runStatus: 'cancelled' }))).toEqual({
      state: 'cancelled',
      reason: null,
    });
  });

  it('gives every run status one of the six states', () => {
    for (const runStatus of runStatusSchema.options) {
      const derived = requestState(facts({ runStatus }));
      expect(requestStateSchema.safeParse(derived.state).success).toBe(true);
      expect(derived.reason?.toLowerCase() ?? '').not.toContain('harness');
    }
  });

  it('is not changed by pause or a held queue once a run carries the request', () => {
    expect(requestState(facts({ runStatus: 'running', paused: true, held: true }))).toEqual({
      state: 'working',
      reason: null,
    });
    expect(requestState(facts({ runStatus: 'queued', paused: true }))).toEqual({
      state: 'sent',
      reason: null,
    });
  });
});

describe('requestState when closed without a run deciding it', () => {
  it('reads cancelled as Cancelled', () => {
    expect(requestState(facts({ closedState: 'cancelled' }))).toEqual({
      state: 'cancelled',
      reason: null,
    });
  });

  it('reads failed as Failed with the stored reason', () => {
    expect(requestState(facts({ closedState: 'failed', closedReason: 'Chat deleted' }))).toEqual({
      state: 'failed',
      reason: 'Chat deleted',
    });
    expect(requestState(facts({ closedState: 'failed' }))).toEqual({
      state: 'failed',
      reason: null,
    });
  });

  it('reads rejected as Failed with a Not delivered line', () => {
    expect(requestState(facts({ closedState: 'rejected', closedReason: 'queue_full' }))).toEqual({
      state: 'failed',
      reason: 'Not delivered: queue full',
    });
    expect(
      requestState(facts({ closedState: 'rejected', closedReason: 'chat_archived' })).reason,
    ).toBe('Not delivered: chat archived');
    expect(
      requestState(facts({ closedState: 'rejected', closedReason: 'not_member' })).reason,
    ).toBe('Not delivered: no longer a member');
  });

  it('keeps a reject reason it does not know and copes with none', () => {
    expect(
      requestState(facts({ closedState: 'rejected', closedReason: 'outpost deleted' })).reason,
    ).toBe('Not delivered: outpost deleted');
    expect(requestState(facts({ closedState: 'rejected' })).reason).toBe('Not delivered');
    expect(requestState(facts({ closedState: 'rejected', closedReason: ' ' })).reason).toBe(
      'Not delivered',
    );
    expect(requestState(facts({ closedState: 'rejected', closedReason: 'toString' })).reason).toBe(
      'Not delivered: toString',
    );
  });

  it('lets the closed state win over a run that finished later', () => {
    expect(requestState(facts({ closedState: 'cancelled', runStatus: 'succeeded' }))).toEqual({
      state: 'cancelled',
      reason: null,
    });
    expect(
      requestState(
        facts({ closedState: 'rejected', closedReason: 'queue_full', runStatus: 'running' }),
      ).state,
    ).toBe('failed');
    expect(requestState(facts({ closedState: 'cancelled', chatDeleted: true })).state).toBe(
      'cancelled',
    );
  });
});

describe('requestState before a run starts', () => {
  it('reads a request that is written but not yet sent as Sent', () => {
    expect(requestState(facts({ sent: false }))).toEqual({ state: 'sent', reason: 'Not sent yet' });
  });

  it('reads a request waiting in the queue as Sent', () => {
    expect(requestState(facts({ queued: true }))).toEqual({ state: 'sent', reason: null });
  });

  it('says the outpost is paused for unsent and queued requests', () => {
    expect(requestState(facts({ sent: false, paused: true }))).toEqual({
      state: 'sent',
      reason: 'Paused',
    });
    expect(requestState(facts({ queued: true, paused: true, held: true }))).toEqual({
      state: 'sent',
      reason: 'Paused',
    });
  });

  it('says why a queued request is held after a failed turn', () => {
    expect(requestState(facts({ toHandle: 'fe', queued: true, held: true }))).toEqual({
      state: 'sent',
      reason: "Waiting: @fe's last turn failed",
    });
  });

  it('does not call an unsent request held', () => {
    expect(requestState(facts({ sent: false, held: true })).reason).toBe('Not sent yet');
  });
});

describe('requestState for a request that waits for another', () => {
  it('names the chat an unsent request waits for', () => {
    expect(requestState(facts({ toHandle: 'web', sent: false, waitingOn: 'api' }))).toEqual({
      state: 'sent',
      reason: 'Waiting for @api',
    });
  });

  it('says so when the chat it waits for was deleted', () => {
    expect(requestState(facts({ sent: false, waitingOnDeleted: true })).reason).toBe(
      'Waiting for a deleted chat',
    );
    expect(requestState(facts({ sent: false, waitingOnDeleted: false })).reason).toBe(
      'Not sent yet',
    );
  });

  it('shows Paused first, since pause also stops the release', () => {
    expect(requestState(facts({ sent: false, paused: true, waitingOn: 'api' })).reason).toBe(
      'Paused',
    );
  });

  it('stops saying it waits once the request is sent, running or closed', () => {
    expect(requestState(facts({ queued: true, waitingOn: 'api' }))).toEqual({
      state: 'sent',
      reason: null,
    });
    expect(requestState(facts({ runStatus: 'running', waitingOn: 'api' }))).toEqual({
      state: 'working',
      reason: null,
    });
    expect(
      requestState(facts({ sent: false, closedState: 'cancelled', waitingOn: 'api' })),
    ).toEqual({ state: 'cancelled', reason: null });
    expect(requestState(facts({ sent: false, chatDeleted: true, waitingOn: 'api' })).reason).toBe(
      'Chat deleted',
    );
  });
});

describe('requestState for a deleted chat', () => {
  it('reads an open request as Failed', () => {
    expect(requestState(facts({ chatDeleted: true }))).toEqual({
      state: 'failed',
      reason: 'Chat deleted',
    });
    expect(requestState(facts({ chatDeleted: true, sent: false, paused: true })).reason).toBe(
      'Chat deleted',
    );
    expect(requestState(facts({ chatDeleted: true, runStatus: 'running' })).state).toBe('failed');
  });
});
