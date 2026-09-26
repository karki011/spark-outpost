import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { ruleTransition } from './transition-choice.ts';
import { initialFlow, nextStep, type FlowEvent, type FlowState } from './transitions.ts';

const STEPS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

function planned(lanes: number[][], worktrees = true): FlowState {
  const state = initialFlow('plan_execute', 'multi-file', 'hands-off', worktrees);
  const architect = nextStep(state, { type: 'start', intake: 'act' }).state;
  return nextStep(architect, {
    type: 'agent_done',
    role: 'architect',
    outcome: 'succeeded',
    steps: STEPS,
    lanes,
  }).state;
}

const judgedNext: FlowEvent = {
  type: 'judged',
  status: 'done',
  next: 'next_step',
  rules: { status: 'done', next: 'next_step' },
  source: 'rules',
  confidence: null,
};

describe('building in chains', () => {
  it('runs setup first, then one Builder per chain in parallel, then the joining step', () => {
    const lanes = [
      [1, 2, 3],
      [4, 5],
    ];
    const afterPlan = nextStep(initialFlow('plan_execute', 'multi-file', 'hands-off', true), {
      type: 'start',
      intake: 'act',
    });
    const plannedResult = nextStep(afterPlan.state, {
      type: 'agent_done',
      role: 'architect',
      outcome: 'succeeded',
      steps: STEPS,
      lanes,
    });
    expect(plannedResult.state.steps).toEqual(STEPS);
    expect(plannedResult.state.ranges).toEqual(STEPS.map((_, index) => [index]));
    expect(plannedResult.action).toMatchObject({ type: 'spawn', role: 'builder', stepIndex: 0 });
    expect(plannedResult.action).not.toHaveProperty('carry');

    const setup = nextStep(plannedResult.state, {
      type: 'agent_done',
      role: 'builder',
      outcome: 'succeeded',
    });
    const group = nextStep(setup.state, judgedNext);
    expect(group.action).toEqual({ type: 'spawn_group', stepIndexes: [1, 4], lanes });

    const merged = nextStep(group.state, {
      type: 'group_done',
      results: [
        { stepIndex: 1, outcome: 'succeeded' },
        { stepIndex: 4, outcome: 'succeeded' },
      ],
      stopped: false,
    });
    expect(merged.state.completed.sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(merged.action).toMatchObject({ type: 'spawn', role: 'builder', stepIndex: 6 });
  });

  it('retries a failed chain one tier up with only its unfinished steps', () => {
    const lanes = [
      [0, 1, 2],
      [3, 4],
    ];
    const state = planned(lanes);
    const failed = nextStep(state, {
      type: 'group_done',
      results: [
        { stepIndex: 0, outcome: 'failed', ticked: [0] },
        { stepIndex: 3, outcome: 'succeeded' },
      ],
      stopped: false,
    });
    expect(failed.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      reason: 'retry',
      escalate: true,
      stepIndex: 1,
      carry: [1, 2],
    });
    expect(ruleTransition(failed.state, 'succeeded').next).toBe('next_step');
  });

  it('resumes only the open chains after the budget runs out', () => {
    const lanes = [
      [0, 1],
      [2, 3],
      [4, 5, 6],
    ];
    const state = planned(lanes);
    const started = { ...state, lastGroup: [0, 2, 4], completed: [0, 1, 2] };
    const exceeded = nextStep(started, { type: 'budget_exceeded', limit: 'time' });
    const resumed = nextStep(exceeded.state, {
      type: 'answered',
      kind: 'budget',
      optionId: CHECKPOINT_OPTION.continueBudget,
      note: null,
    });
    expect(resumed.action).toEqual({
      type: 'spawn_group',
      stepIndexes: [3, 4],
      lanes: [[3], [4, 5, 6]],
    });
  });

  it('ignores chains outside git, where one Builder carries the plan', () => {
    const state = planned([[0, 1], [2]], false);
    expect(state.lanes).toEqual([]);
  });
});

describe('reviews for review requests', () => {
  it('adds a Critic after an execute-depth Builder when Jev reads the request as a review', () => {
    const state = initialFlow('execute', 'edits', 'full-auto', true, true);
    const builder = nextStep(state, { type: 'start', intake: 'act' });
    const judged = nextStep(
      nextStep(builder.state, { type: 'agent_done', role: 'builder', outcome: 'succeeded' }).state,
      judgedNext,
    );
    expect(judged.action).toMatchObject({ type: 'spawn', role: 'critic' });
    expect(ruleTransition(builder.state, 'succeeded').next).toBe('review');
  });

  it('does not add one otherwise', () => {
    const state = initialFlow('execute', 'edits', 'full-auto', true, false);
    const builder = nextStep(state, { type: 'start', intake: 'act' });
    expect(ruleTransition(builder.state, 'succeeded').next).toBe('finish');
  });
});
