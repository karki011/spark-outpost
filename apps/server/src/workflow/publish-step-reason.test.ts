import { describe, expect, it } from 'vitest';
import { publishReason, type ReasonFacts } from './publish-step-reason.ts';

const turn: ReasonFacts = {
  mode: 'do',
  level: 'hands-off',
  userRequest: 'Tidy the notes',
  parentRunId: null,
};

const fromAnotherChat = { postId: 'p1', outpostName: 'Launch', fromUser: false };

describe('publishReason', () => {
  it('has no reason at Automatic when the message did not ask', () => {
    expect(publishReason(turn)).toBeNull();
  });

  it('publishes at Full auto → PR, when the message asks, and in a follow-up round', () => {
    expect(publishReason({ ...turn, level: 'full-auto' })).toBe('full-auto');
    expect(publishReason({ ...turn, userRequest: 'Fix it and open a PR' })).toBe('asked');
    expect(publishReason({ ...turn, followUpRound: true })).toBe('follow-up');
  });

  it('treats a follow-up round as one even at Full auto → PR', () => {
    expect(publishReason({ ...turn, level: 'full-auto', followUpRound: true })).toBe('follow-up');
  });

  it('never publishes from a read-only turn, a child run or the assistant', () => {
    const asked = { ...turn, level: 'full-auto' as const, userRequest: 'push it' };
    expect(publishReason({ ...asked, mode: 'ask' })).toBeNull();
    expect(publishReason({ ...asked, mode: null })).toBeNull();
    expect(publishReason({ ...asked, parentRunId: 'run-1' })).toBeNull();
    expect(publishReason({ ...asked, assistant: true })).toBeNull();
  });

  it('does not count a request that came from another chat as the user asking', () => {
    const request = { ...turn, userRequest: 'push it', outpostRequest: fromAnotherChat };
    expect(publishReason(request)).toBeNull();
  });

  it('never publishes from a story wrap-up', () => {
    const wrapUp = { ...fromAnotherChat, fromUser: true, wrapUp: true };
    expect(publishReason({ ...turn, level: 'full-auto', outpostRequest: wrapUp })).toBeNull();
  });

  it('is a push-only ask when the message asks for the push and not the pull request', () => {
    const pushOnly = 'Push this branch, but do not open a pull request';
    expect(publishReason({ ...turn, userRequest: pushOnly })).toBe('asked-push');
    expect(publishReason({ ...turn, userRequest: 'Fix it and push it' })).toBe('asked-push');
    expect(publishReason({ ...turn, userRequest: 'Push it and open a PR' })).toBe('asked');
  });

  it('keeps the pull request at Full auto → PR when the message asks only for the push', () => {
    expect(publishReason({ ...turn, level: 'full-auto', userRequest: 'Fix it and push it' })).toBe(
      'asked',
    );
  });
});
