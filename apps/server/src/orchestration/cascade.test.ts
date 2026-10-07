import { describe, expect, it } from 'vitest';
import { cascadeAction, DECLINED_REASON, UNCONFIRMED_REASON } from './cascade.ts';
import {
  escalateFollowUp,
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

const green: FlowEvent = { type: 'agent_done', role: 'builder', outcome: 'succeeded', green: true };
const start: FlowEvent = { type: 'start', start: 'build' };
const verdict = (
  accepted: 'supported' | 'unsupported' | 'declined' | null,
  reasons: string[] = [],
): FlowEvent => ({ type: 'verified', accepted, reasons });

const withJev = (level: 'hands-off' | 'full-auto' = 'hands-off') =>
  initialFlow('edits', level, false, true);

describe('verified cascade', () => {
  it('asks Jev for a verdict after a green Builder, and a supported change wraps up as today', () => {
    const [, built, verified] = run(withJev(), [start, green, verdict('supported')]);
    expect(built!.action).toEqual({ type: 'verify' });
    expect(verified!.action).toEqual({ type: 'wrap_up' });
    expect(verified!.state.escalated).toBe(false);
  });

  it('reruns the Builder once, one tier up, with the unmet requirements as the follow-up', () => {
    const results = run(withJev(), [
      start,
      green,
      verdict('unsupported', ['Return 0 when total is 0.']),
      green,
      verdict('unsupported', ['Return 0 when total is 0.']),
    ]);
    expect(results[2]!.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      reason: 'escalate',
      escalate: true,
      followUp: escalateFollowUp(['Return 0 when total is 0.']),
    });
    expect(String((results[2]!.action as { followUp: string }).followUp)).toContain(
      '"Return 0 when total is 0."',
    );
    expect(results[3]!.action).toEqual({ type: 'verify' });
    expect(results[4]!.action).toEqual({ type: 'wrap_up' });
    expect(results[4]!.state).toMatchObject({ escalated: true, verdicts: 2 });
  });

  it('says it needs you when Jev declines, marks the change unverified and carries on', () => {
    const [, , declined] = run(withJev(), [start, green, verdict('declined')]);
    expect(declined!.action).toEqual({ type: 'wrap_up' });
    expect(declined!.state).toMatchObject({
      unverified: true,
      needsYou: `Needs you: ${DECLINED_REASON}`,
    });
    const finished = nextStep(declined!.state, { type: 'kept' });
    expect(finished.action).toMatchObject({
      type: 'finish',
      status: 'succeeded',
      incomplete: `Needs you: ${DECLINED_REASON}`,
    });
  });

  it('finishes as today when the verdict is below the line', () => {
    const [, , verified] = run(withJev('full-auto'), [start, green, verdict(null)]);
    expect(verified!.action).toEqual({ type: 'wrap_up' });
  });

  it('keeps the flow unchanged without Jev: checks only, no verdict', () => {
    const [, built] = run(initialFlow('edits', 'hands-off'), [start, green]);
    expect(built!.action).toEqual({ type: 'wrap_up' });
  });

  it('asks no verdict when the checks still fail or nothing changed', () => {
    const red: FlowEvent = {
      type: 'agent_done',
      role: 'builder',
      outcome: 'succeeded',
      green: false,
    };
    expect(run(withJev(), [start, red])[1]!.action).toEqual({ type: 'wrap_up' });
  });

  it('verifies before the Critic and keeps the large-diff review after the verdict', () => {
    const large: FlowEvent = { ...green, large: true } as FlowEvent;
    const [, , verified] = run(withJev(), [start, large, verdict('supported')]);
    expect(verified!.action).toMatchObject({ type: 'spawn', role: 'critic' });
  });

  it('acts only on the first verdict of a turn', () => {
    expect(cascadeAction('unsupported', false)).toBe('escalate');
    expect(cascadeAction('declined', false)).toBe('ask');
    expect(cascadeAction('supported', false)).toBe('finish');
    expect(cascadeAction(null, false)).toBe('finish');
    expect(cascadeAction('unsupported', true)).toBe('finish');
    expect(cascadeAction('declined', true)).toBe('finish');
  });

  it("says it needs you instead of rerunning when Jev names nothing missing for sure and Spark's checks pass (H)", () => {
    const settled = { checksPass: true, criticConcerns: false, confidentUnmet: false };
    expect(cascadeAction('unsupported', false, settled)).toBe('ask');
    expect(cascadeAction('unsupported', false, { ...settled, checksPass: false })).toBe('escalate');
    expect(cascadeAction('unsupported', false, { ...settled, criticConcerns: true })).toBe(
      'escalate',
    );
    expect(cascadeAction('unsupported', false, { ...settled, confidentUnmet: true })).toBe(
      'escalate',
    );
    expect(cascadeAction('declined', false, settled)).toBe('ask');
    const unconfirmed: FlowEvent = {
      type: 'verified',
      accepted: 'unsupported',
      reasons: [],
      evidence: settled,
    };
    const [, , asked] = run(withJev(), [start, green, unconfirmed]);
    expect(asked!.action).toEqual({ type: 'wrap_up' });
    expect(asked!.state).toMatchObject({
      escalated: false,
      unverified: true,
      needsYou: `Needs you: ${UNCONFIRMED_REASON}`,
    });
  });
});
