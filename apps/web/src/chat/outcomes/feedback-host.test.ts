import { describe, expect, it } from 'vitest';
import { checkpointPayloadSchema, type Approval } from '@spark-outpost/contracts';
import { keepCardHost } from './feedback-host.ts';

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
