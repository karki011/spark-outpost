import { describe, expect, it } from 'vitest';
import { checkpointPayloadSchema, type Approval, type PrOpenedVia } from '@spark-outpost/contracts';
import { RUN, watch } from '../pull-request/watch-fixture.ts';
import { isFeedbackTurn, keepCardHost } from './feedback-host.ts';

function accept(
  id: string,
  decisionOptionId: string | null,
): Pick<Approval, 'id' | 'decisionOptionId' | 'payload' | 'status'> {
  return {
    id,
    decisionOptionId,
    status: decisionOptionId === null ? 'pending' : 'allowed',
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      checkpoint: checkpointPayloadSchema.parse({ kind: 'accept', question: 'Keep?', reason: '' }),
    },
  };
}

describe('keep card host', () => {
  it('puts feedback on the last keep card answered with Keep or Revert', () => {
    expect(keepCardHost([accept('a', 'fix'), accept('b', 'keep')])).toEqual({
      approvalId: 'b',
      variant: 'kept',
    });
    expect(keepCardHost([accept('a', 'keep'), accept('b', 'revert')])).toEqual({
      approvalId: 'b',
      variant: 'reverted',
    });
  });

  it('asks what went wrong once a kept change is reverted afterwards', () => {
    expect(keepCardHost([accept('a', 'keep')], true)).toEqual({
      approvalId: 'a',
      variant: 'reverted',
    });
    expect(keepCardHost([accept('a', 'fix')], true)).toBeNull();
  });

  it('has no host while pending, after only a fix, or without a keep card', () => {
    expect(keepCardHost([accept('a', null)])).toBeNull();
    expect(keepCardHost([accept('a', 'fix')])).toBeNull();
    expect(keepCardHost([])).toBeNull();
  });
});

describe('feedback turn', () => {
  const opener = 'run-opened-pr';
  const later = 'run-follow-up';
  const openedBy = (runId: string | null, at: string, via: PrOpenedVia = 'agent') =>
    watch({ opened: { via, by: null, runId, at } });

  it('shows on the turn that opened the chat’s pull request, matching any run of that turn', () => {
    expect(isFeedbackTurn([watch()], [RUN])).toBe(true);
    expect(isFeedbackTurn([openedBy(opener, '2026-10-05T10:00:00Z')], ['top', opener])).toBe(true);
  });

  it('does not show on later turns that push follow-ups to the same pull request', () => {
    expect(isFeedbackTurn([openedBy(opener, '2026-10-05T10:00:00Z')], [later])).toBe(false);
  });

  it('shows on no turn in a chat without a pull request it opened', () => {
    expect(isFeedbackTurn([], [opener])).toBe(false);
    const found = [
      openedBy(null, '2026-10-05T09:00:00Z', 'adopted'),
      openedBy(null, '2026-10-05T09:30:00Z', 'discovery'),
    ];
    expect(isFeedbackTurn(found, [opener])).toBe(false);
  });

  it('shows once per chat: on the first of two pull requests only', () => {
    const pulls = [
      openedBy(later, '2026-10-06T10:00:00Z'),
      openedBy(opener, '2026-10-05T10:00:00Z'),
    ];
    expect(isFeedbackTurn(pulls, [opener])).toBe(true);
    expect(isFeedbackTurn(pulls, [later])).toBe(false);
  });

  it('skips a found pull request with no turn and shows on the first one a turn opened', () => {
    const pulls = [
      openedBy(null, '2026-10-04T10:00:00Z', 'discovery'),
      openedBy(opener, '2026-10-05T10:00:00Z'),
    ];
    expect(isFeedbackTurn(pulls, [opener])).toBe(true);
  });
});
