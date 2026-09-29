import {
  PERMISSION_ASK,
  PERMISSION_DO,
  type ConversationDetail,
  type Run,
} from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { answeredInsteadOfChange } from './make-change.ts';

const answered = {
  id: 'r1',
  status: 'succeeded',
  mode: 'ask',
  pickedMode: 'do',
  parentRunId: null,
} as Run;

function detail(runs: Partial<Run>[], permission: string = PERMISSION_DO): ConversationDetail {
  return { runs, settings: { permission } } as unknown as ConversationDetail;
}

describe('the "Make the change" offer', () => {
  it('shows under the latest Do turn that Spark answered instead of changing files', () => {
    expect(answeredInsteadOfChange(answered, detail([answered]))).toBe(true);
  });

  it('hides for Ask turns, built turns, failed turns, older turns and chats switched to Ask', () => {
    const cases: [Partial<Run>, Partial<Run>[]?, string?][] = [
      [{ pickedMode: 'ask' }],
      [{ mode: 'do' }],
      [{ status: 'failed' }],
      [{}, [answered, { id: 'r2', parentRunId: null }]],
      [{}, [answered], PERMISSION_ASK],
    ];
    for (const [change, runs, permission] of cases) {
      const run = { ...answered, ...change } as Run;
      expect(answeredInsteadOfChange(run, detail(runs ?? [run], permission))).toBe(false);
    }
  });

  it('ignores crew members when finding the latest turn', () => {
    const child = { id: 'c1', parentRunId: 'r1' };
    expect(answeredInsteadOfChange(answered, detail([answered, child]))).toBe(true);
  });
});
