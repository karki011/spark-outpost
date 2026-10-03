import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type InvolvementLevel } from '@spark-outpost/contracts';
import { initialFlow, nextStep, type FlowEvent, type FlowState } from './transitions.ts';

const flow = (level: InvolvementLevel = 'hands-off') => initialFlow('edits', level);

function after(state: FlowState, events: readonly FlowEvent[]) {
  let result = nextStep(state, events[0]!);
  for (const event of events.slice(1)) result = nextStep(result.state, event);
  return result;
}

describe('a vague request asks the agent first', () => {
  it('runs a read-only clarify turn, then goes on with what the intake would do', () => {
    const asked = nextStep(flow(), { type: 'start', start: 'ask_agent', then: 'build' });
    expect(asked.action).toEqual({ type: 'ask_agent', then: 'build' });
    expect(asked.state.depth).toBe('direct');
    expect(nextStep(asked.state, { type: 'clarified', start: 'build' }).action).toMatchObject({
      type: 'spawn',
      role: 'builder',
    });
    expect(nextStep(asked.state, { type: 'clarified', start: 'answer' }).action).toMatchObject({
      role: 'scout',
    });
    expect(nextStep(asked.state, { type: 'clarified', start: null }).action).toMatchObject({
      type: 'finish',
      status: 'cancelled',
    });
  });

  it('plans first after clarifying when the intake said so, even from a fixed card', () => {
    const asked = nextStep(flow('full-auto'), {
      type: 'start',
      start: 'ask_agent',
      then: 'plan_first',
    });
    expect(nextStep(asked.state, { type: 'clarified', start: 'plan_first' }).action).toEqual({
      type: 'plan_first',
      note: null,
    });
    expect(nextStep(asked.state, { type: 'clarified', start: 'build' }).action).toEqual({
      type: 'plan_first',
      note: null,
    });
  });

  it('falls back to the fixed cards when the agent asked nothing usable', () => {
    expect(nextStep(flow(), { type: 'unclear', followUp: false }).action).toMatchObject({
      type: 'ask',
      kind: 'clarify',
      interpret: true,
    });
  });
});

describe('plan first, then build', () => {
  const planned = (level: InvolvementLevel) =>
    nextStep(flow(level), { type: 'start', start: 'plan_first' });

  it('builds the plan on Build, and revises it on Edit', () => {
    expect(planned('full-auto').action).toEqual({ type: 'plan_first', note: null });
    const built = after(planned('full-auto').state, [
      { type: 'answered', kind: 'plan', optionId: CHECKPOINT_OPTION.makeChange, note: null },
    ]);
    expect(built.action).toMatchObject({ type: 'spawn', role: 'builder', reason: 'first' });
    expect(built.state.depth).toBe('execute');
    const edited = after(planned('hands-off').state, [
      { type: 'answered', kind: 'plan', optionId: CHECKPOINT_OPTION.editPlan, note: 'skip docs' },
    ]);
    expect(edited.action).toEqual({ type: 'plan_first', note: 'skip docs' });
  });

  it('ends without changes on Stop', () => {
    const stopped = after(planned('full-auto').state, [
      { type: 'answered', kind: 'plan', optionId: CHECKPOINT_OPTION.stop, note: null },
    ]);
    expect(stopped.action).toMatchObject({ type: 'finish', status: 'cancelled' });
  });
});
