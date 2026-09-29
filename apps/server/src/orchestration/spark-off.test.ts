import { describe, expect, it } from 'vitest';
import { context } from './route-fixtures.ts';
import { routeBuilder, soloRoute, SPARK_OFF_RULE } from './routing.ts';
import { initialFlow, nextStep, type FlowEvent, type FlowState } from './transitions.ts';

const solo = (review = false): FlowState => ({
  ...initialFlow('destructive', 'hands-off', review),
  solo: true,
});

const built = (extra: Partial<Extract<FlowEvent, { type: 'agent_done' }>> = {}): FlowEvent => ({
  type: 'agent_done',
  role: 'builder',
  outcome: 'succeeded',
  ...extra,
});

describe('Spark off flow', () => {
  it('builds once and wraps up without a Critic, even for destructive or large work', () => {
    const started = nextStep(solo(true), { type: 'start', start: 'build' });
    expect(started.action).toMatchObject({ type: 'spawn', role: 'builder', reason: 'first' });
    const done = nextStep(started.state, built({ large: true, green: true }));
    expect(done.action).toEqual({ type: 'wrap_up' });
  });

  it('stops on a failed Builder instead of retrying with a stronger model', () => {
    const started = nextStep(solo(), { type: 'start', start: 'build' });
    const failed = nextStep(started.state, built({ outcome: 'failed', error: 'It broke.' }));
    expect(failed.action).toMatchObject({ type: 'finish', status: 'failed', reason: 'It broke.' });
  });

  it('does not send the Builder back for open plan items', () => {
    const started = nextStep(solo(), { type: 'start', start: 'build' });
    const done = nextStep(started.state, built({ open: ['Add tests'] }));
    expect(done.action).toEqual({ type: 'wrap_up' });
  });

  it('still asks before risky work at Review each step', () => {
    const risky = {
      ...initialFlow('destructive', 'balanced', true, false, 'Deletes files.'),
      solo: true,
    };
    const started = nextStep(risky, { type: 'start', start: 'build' });
    expect(started.action).toMatchObject({ type: 'ask', kind: 'plan', reason: 'Deletes files.' });
  });

  it('keeps the Critic when Spark is on', () => {
    const on = initialFlow('destructive', 'hands-off', true);
    const started = nextStep(on, { type: 'start', start: 'build' });
    expect(nextStep(started.state, built()).action).toMatchObject({ role: 'critic' });
  });
});

describe('soloRoute', () => {
  it('uses exactly the chat pick where the rules would move to another tier', () => {
    const auto = context('auto');
    expect(routeBuilder(auto, { trivial: true, destructive: true }).pick.model).not.toBe(
      auto.chat.model,
    );
    expect(soloRoute(auto)).toMatchObject({
      pick: { provider: auto.chat.provider, model: auto.chat.model, effort: auto.chat.effort },
      routedBy: 'pinned',
      rule: SPARK_OFF_RULE,
      autoWouldUse: null,
    });
  });
});
