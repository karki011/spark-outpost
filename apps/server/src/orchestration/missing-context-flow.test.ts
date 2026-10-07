import { describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
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
  it('says what it needs in the reply instead of retrying one tier up at Automatic', () => {
    const [, failed] = run(flow(), [start, failedMissing]);
    expect(failed!.action).toEqual({
      type: 'finish',
      status: 'succeeded',
      reason: null,
      incomplete: `Needs you: ${MISSING}`,
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

  it('says what it needs instead of escalating when Jev cannot confirm a change made without context', () => {
    const [, built, verified] = run(flow('hands-off', true), [
      start,
      greenMissing,
      { type: 'verified', accepted: 'unsupported', reasons: [] },
    ]);
    expect(built!.action).toEqual({ type: 'verify' });
    expect(verified!.action).toMatchObject({
      type: 'finish',
      status: 'succeeded',
      incomplete: expect.stringMatching(/^Needs you: /),
    });
  });
});
