import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type InvolvementLevel } from '@spark-outpost/contracts';
import {
  initialFlow,
  nextStep,
  type FlowEvent,
  type FlowResult,
  type FlowState,
} from './transitions.ts';

function run(state: FlowState, events: readonly FlowEvent[]): FlowResult[] {
  const results: FlowResult[] = [];
  let current = state;
  for (const event of events) {
    const result = nextStep(current, event);
    results.push(result);
    current = result.state;
  }
  return results;
}

const MISSING = 'There is no src/dates.ts in this repo.';
const start: FlowEvent = { type: 'start', start: 'build' };
const failedMissing: FlowEvent = {
  type: 'agent_done',
  role: 'builder',
  outcome: 'failed',
  error: 'The agent hit a problem.',
  missingContext: MISSING,
};
const greenMissing: FlowEvent = {
  type: 'agent_done',
  role: 'builder',
  outcome: 'succeeded',
  green: true,
  missingContext: MISSING,
};
const flow = (level: InvolvementLevel = 'hands-off', verifier = false) =>
  initialFlow('edits', level, false, verifier);

describe('no tier-up when the Builder is missing context', () => {
  it('asks where to look instead of retrying one tier up at Automatic', () => {
    const [, failed] = run(flow(), [start, failedMissing]);
    expect(failed!.action).toEqual({
      type: 'ask',
      kind: 'clarify',
      reason: MISSING,
      context: true,
    });
  });

  it('stops and reports at Full auto instead of escalating', () => {
    const [, failed] = run(flow('full-auto'), [start, failedMissing]);
    expect(failed!.action).toMatchObject({ type: 'finish', status: 'failed' });
    expect(String((failed!.action as { reason: string }).reason)).toContain(MISSING);
  });

  it('still retries one tier up for an ordinary failure', () => {
    const [, failed] = run(flow(), [
      start,
      { type: 'agent_done', role: 'builder', outcome: 'failed', error: 'boom' },
    ]);
    expect(failed!.action).toMatchObject({ type: 'spawn', reason: 'retry', escalate: true });
  });

  it('asks instead of escalating when Jev cannot confirm a change made without context', () => {
    const [, built, verified] = run(flow('hands-off', true), [
      start,
      greenMissing,
      { type: 'verified', accepted: 'unsupported', reasons: [] },
    ]);
    expect(built!.action).toEqual({ type: 'verify' });
    expect(verified!.action).toMatchObject({ type: 'ask', kind: 'clarify', context: true });
  });

  it('reruns the Builder at the same tier with the user’s answer, or stops', () => {
    const [, asked] = run(flow(), [start, failedMissing]);
    const answered = nextStep(asked!.state, {
      type: 'answered',
      kind: 'clarify',
      optionId: CHECKPOINT_OPTION.answer,
      note: 'the formatter is in packages/dates',
    });
    expect(answered.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      escalate: false,
      note: 'the formatter is in packages/dates',
    });
    expect(answered.state.missingContext).toBeNull();
    const stopped = nextStep(asked!.state, {
      type: 'answered',
      kind: 'clarify',
      optionId: CHECKPOINT_OPTION.stop,
      note: null,
    });
    expect(stopped.action).toMatchObject({ type: 'finish', status: 'cancelled' });
  });
});
