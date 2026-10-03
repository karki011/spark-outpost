import { describe, expect, it } from 'vitest';
import type { ConversationDetail, Run } from '@spark-outpost/contracts';
import { sameTurnDetail } from './turn-props.ts';

const run = (id: string, extra: Partial<Run> = {}) => ({ id, parentRunId: null, ...extra }) as Run;

function detail(runs: Run[], activity: ConversationDetail['activity']): ConversationDetail {
  return {
    runs,
    activity,
    messages: [],
    approvals: [],
    tasks: [],
    orchestrations: {},
  } as unknown as ConversationDetail;
}

describe('turn detail comparison', () => {
  const old = run('old');
  const live = run('live');
  const steps = [{ name: 'Read a file', done: true }];
  const before = detail([old, live], { old: steps, live: [] });
  const shared = before.runs;

  it('lets a finished turn skip a refresh that only touched the live turn', () => {
    const after = {
      ...before,
      runs: [old, run('live', { status: 'running' })],
      activity: { old: steps, live: [{ name: 'Edit a file', done: false }] },
    };
    expect(sameTurnDetail(before, after, old)).toBe(true);
    expect(sameTurnDetail(before, after, live)).toBe(false);
  });

  it('re-renders every turn when shared data or the latest turn changes', () => {
    expect(sameTurnDetail(before, { ...before, messages: [] }, old)).toBe(false);
    const newer = { ...before, runs: [...shared, run('next')] };
    expect(sameTurnDetail(before, newer, old)).toBe(false);
  });
});
