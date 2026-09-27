import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type InvolvementLevel } from '@spark-outpost/contracts';
import { ruleTransition } from './transition-choice.ts';
import { initialFlow, nextStep, type FlowEvent, type FlowState } from './transitions.ts';

function planned(steps: string[], lanes: number[][] = [], level: InvolvementLevel = 'hands-off') {
  const state = initialFlow('plan_execute', 'multi-file', level, lanes.length > 0);
  const architect = nextStep(state, { type: 'start', intake: 'act' }).state;
  return nextStep(architect, {
    type: 'agent_done',
    role: 'architect',
    outcome: 'succeeded',
    steps,
    lanes,
  });
}

const built = (ticked: number[] = []): FlowEvent => ({
  type: 'agent_done',
  role: 'builder',
  outcome: 'succeeded',
  ticked,
});

function byRules(state: FlowState, outcome: 'succeeded' | 'failed' = 'succeeded'): FlowEvent {
  const rules = ruleTransition(state, outcome);
  return { type: 'judged', ...rules, rules, source: 'rules', confidence: null };
}

const jevSays = (next: 'finish' | 'review'): FlowEvent => ({
  type: 'judged',
  status: 'done',
  next,
  rules: { status: 'done', next },
  source: 'jev',
  confidence: 0.95,
});

describe('open plan steps', () => {
  it('continues the same Builder when it stopped after its first carried step', () => {
    const plan = planned(['a', 'b', 'c']);
    expect(plan.action).toMatchObject({ type: 'spawn', carry: [0, 1, 2] });
    const judging = nextStep(plan.state, built([0])).state;
    expect(ruleTransition(judging, 'succeeded')).toEqual({ status: 'done', next: 'next_step' });
    const continued = nextStep(judging, jevSays('finish'));
    expect(continued.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      reason: 'continue',
      stepIndex: 1,
      carry: [1, 2],
      from: 0,
      escalate: false,
    });
    expect(continued.action.type === 'spawn' && continued.action.followUp).toContain(
      'steps 2 and 3 of the plan are still open',
    );
    expect(continued.state.completed).toEqual([0]);

    const second = nextStep(continued.state, built([1, 2])).state;
    const wrapped = nextStep(second, byRules(second));
    expect(wrapped.action).toEqual({ type: 'wrap_up' });
    expect(wrapped.state.completed.sort()).toEqual([0, 1, 2]);
  });

  it('treats a later step marker as covering the steps before it', () => {
    const plan = planned(['a', 'b', 'c']);
    const judging = nextStep(plan.state, built([1])).state;
    const continued = nextStep(judging, byRules(judging));
    expect(continued.action).toMatchObject({ reason: 'continue', stepIndex: 2, from: 0 });
    expect(continued.action).not.toHaveProperty('carry');
  });

  it('keeps the name of the first Builder across continuations', () => {
    const plan = planned(['a', 'b', 'c', 'd']);
    const first = nextStep(plan.state, built([0])).state;
    const second = nextStep(first, byRules(first));
    const third = nextStep(second.state, built([1]));
    const again = nextStep(third.state, byRules(third.state));
    expect(again.action).toMatchObject({
      reason: 'continue',
      stepIndex: 2,
      carry: [2, 3],
      from: 0,
    });
  });

  it('builds the open steps before a review Jev asks for', () => {
    const plan = planned(['a', 'b']);
    const judging = nextStep(plan.state, built([0])).state;
    expect(nextStep(judging, jevSays('review')).action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      stepIndex: 1,
    });
  });

  it('still completes a carried span when the Builder wrote no step markers', () => {
    const plan = planned(['a', 'b', 'c']);
    const judging = nextStep(plan.state, built()).state;
    expect(nextStep(judging, byRules(judging)).action).toEqual({ type: 'wrap_up' });
  });

  it('reports the run incomplete when the user finishes with steps still open', () => {
    const plan = planned(['a', 'b', 'c'], [], 'hands-on');
    const approved = nextStep(plan.state, {
      type: 'answered',
      kind: 'plan',
      optionId: CHECKPOINT_OPTION.approvePlan,
      note: null,
    });
    const failed = nextStep(approved.state, {
      type: 'agent_done',
      role: 'builder',
      outcome: 'failed',
      ticked: [0],
    }).state;
    const asked = nextStep(failed, byRules(failed, 'failed'));
    expect(asked.action).toMatchObject({ type: 'ask', kind: 'retry' });
    const finishing = nextStep(asked.state, {
      type: 'answered',
      kind: 'retry',
      optionId: CHECKPOINT_OPTION.finish,
      note: null,
    });
    expect(finishing.action).toEqual({ type: 'wrap_up' });
    const done = nextStep(finishing.state, { type: 'wrapped', filesChanged: 1, asksToKeep: false });
    expect(done.action).toEqual({
      type: 'finish',
      status: 'succeeded',
      reason: null,
      incomplete:
        'Incomplete: steps 2 and 3 of 3 are still open. Ask to continue and a Builder picks up from there.',
    });
  });
});

describe('open steps with chains', () => {
  const STEPS = ['setup', 'a1', 'a2', 'b1', 'b2', 'join'];
  const LANES = [
    [1, 2],
    [3, 4],
  ];

  it('runs the steps outside every chain in order around the chains', () => {
    const plan = planned(STEPS, LANES);
    expect(plan.action).toMatchObject({ type: 'spawn', role: 'builder', stepIndex: 0 });
    expect(plan.action).not.toHaveProperty('carry');
    const setup = nextStep(plan.state, built()).state;
    const group = nextStep(setup, byRules(setup));
    expect(group.action).toMatchObject({ type: 'spawn_group', stepIndexes: [1, 3] });
    const merged = nextStep(group.state, {
      type: 'group_done',
      results: [
        { stepIndex: 1, outcome: 'succeeded' },
        { stepIndex: 3, outcome: 'succeeded' },
      ],
      stopped: false,
    });
    expect(merged.action).toMatchObject({ type: 'spawn', role: 'builder', stepIndex: 5 });
    const join = nextStep(merged.state, built()).state;
    expect(nextStep(join, byRules(join)).action).toEqual({ type: 'wrap_up' });
  });

  it('runs the rest of a chain whose Builder stopped early before the joining step', () => {
    const plan = planned(STEPS, LANES);
    const setup = nextStep(plan.state, built()).state;
    const group = nextStep(setup, byRules(setup));
    const merged = nextStep(group.state, {
      type: 'group_done',
      results: [
        { stepIndex: 1, outcome: 'succeeded', ticked: [1] },
        { stepIndex: 3, outcome: 'succeeded' },
      ],
      stopped: false,
    });
    expect(merged.state.completed.sort()).toEqual([0, 1, 3, 4]);
    expect(merged.action).toMatchObject({ type: 'spawn', role: 'builder', stepIndex: 2 });
    const rest = nextStep(merged.state, built()).state;
    expect(nextStep(rest, byRules(rest)).action).toMatchObject({ type: 'spawn', stepIndex: 5 });
  });
});

describe('stopping at a budget', () => {
  it('says which steps are open and that the changes were not reviewed', () => {
    const state = initialFlow('plan_execute_review', 'edits', 'hands-off');
    const architect = nextStep(state, { type: 'start', intake: 'act' }).state;
    const building = nextStep(architect, {
      type: 'agent_done',
      role: 'architect',
      outcome: 'succeeded',
      steps: ['a', 'b'],
    }).state;
    const asked = nextStep(building, { type: 'budget_exceeded', limit: 'tool_calls', ticked: [0] });
    const stopped = nextStep(asked.state, {
      type: 'answered',
      kind: 'budget',
      optionId: CHECKPOINT_OPTION.stop,
      note: null,
    });
    expect(stopped.action).toMatchObject({
      type: 'finish',
      status: 'failed',
      reason:
        'Stopped: the tool calls budget ran out. Incomplete: step 2 of 2 is still open. Ask to continue and a Builder picks up from there. The changes so far were not reviewed.',
    });
  });
});
