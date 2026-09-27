import { describe, expect, it } from 'vitest';
import { MAX_REPAIR_RETRIES } from '@spark-outpost/contracts';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import {
  buildStepCheckQuestions,
  openSteps,
  parseStepChecks,
  stepCheckSummary,
  stepChecksFor,
  type StepCheck,
} from './step-checks.ts';
import { ruleTransition } from './transition-choice.ts';
import { initialFlow, nextStep, type FlowEvent, type FlowState } from './transitions.ts';

const nouls = (values: Record<string, number>): SystemOneResponse => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    Object.entries(values).map(([key, noul]) => [key, { type: 'noul' as const, noul }]),
  ),
});

const CHECKS: StepCheck[] = [
  { stepIndex: 0, text: 'Add the parser in src/parse.ts', criteria: ['Empty input returns []'] },
  { stepIndex: 1, text: 'Wire it into the CLI', criteria: [] },
];

describe('step check questions', () => {
  it('asks three kinds of bad-is-true nouls per step, with paths removed', () => {
    const questions = buildStepCheckQuestions(CHECKS);
    expect(Object.keys(questions)).toEqual([
      'step_not_done_1',
      'step_left_1',
      'criterion_unmet_1_1',
      'step_not_done_2',
      'step_left_2',
    ]);
    expect(questions.step_left_1!.instructions).toMatchObject({
      plan_step: 'Add the parser in [path]',
    });
    expect(questions.criterion_unmet_1_1!.instructions).toMatchObject({
      criterion: 'Empty input returns []',
    });
  });

  it('takes each step’s criteria from its work order once, three at most', () => {
    const steps = ['one', 'two', ''];
    const checks = stepChecksFor(steps, [0, 1, 2], (index) =>
      index === 0 ? ['a', 'b', 'c', 'd'] : ['a', 'e'],
    );
    expect(checks).toEqual([
      { stepIndex: 0, text: 'one', criteria: ['a', 'b', 'c'] },
      { stepIndex: 1, text: 'two', criteria: ['e'] },
    ]);
  });
});

describe('step check answers', () => {
  it('acts on the worst answer for each step', () => {
    const answers = parseStepChecks(
      CHECKS,
      nouls({
        step_not_done_1: 0.05,
        step_left_1: 0.1,
        criterion_unmet_1_1: 0.86,
        step_not_done_2: 0.12,
        step_left_2: 0.08,
      }),
    );
    expect(answers).toEqual([
      { stepIndex: 0, worst: 0.86, worstKey: 'criterion_unmet_1_1', verdict: 'open' },
      { stepIndex: 1, worst: 0.12, worstKey: 'step_not_done_2', verdict: 'done' },
    ]);
    expect(openSteps(answers)).toEqual([0]);
    expect(stepCheckSummary(answers)).toBe('Jev: step 1 (0.86) not done');
  });

  it('leaves the middle band and unanswered steps to the rules', () => {
    const answers = parseStepChecks(CHECKS, nouls({ step_left_1: 0.5 }));
    expect(answers).toEqual([
      { stepIndex: 0, worst: 0.5, worstKey: 'step_left_1', verdict: 'unsure' },
    ]);
    expect(openSteps(answers)).toEqual([]);
    expect(stepCheckSummary(answers)).toBeNull();
  });
});

function planned(steps: string[]) {
  const state = initialFlow('plan_execute', 'multi-file', 'hands-off');
  const architect = nextStep(state, { type: 'start', intake: 'act' }).state;
  return nextStep(architect, {
    type: 'agent_done',
    role: 'architect',
    outcome: 'succeeded',
    steps,
  });
}

const built = (ticked: number[] = []): FlowEvent => ({
  type: 'agent_done',
  role: 'builder',
  outcome: 'succeeded',
  ticked,
});

function judged(state: FlowState, open?: number[]): FlowEvent {
  const rules = ruleTransition(state, 'succeeded');
  return {
    type: 'judged',
    ...rules,
    rules,
    source: 'rules',
    confidence: null,
    ...(open ? { open } : {}),
  };
}

describe('steps Jev finds not done', () => {
  it('continues the same Builder on a step it ticked but did not finish', () => {
    const plan = planned(['a', 'b', 'c']);
    const judging = nextStep(plan.state, built([0, 1, 2])).state;
    expect(nextStep(judging, judged(judging)).action).toEqual({ type: 'wrap_up' });
    const continued = nextStep(judging, judged(judging, [1]));
    expect(continued.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      reason: 'continue',
      stepIndex: 1,
      from: 0,
      escalate: false,
    });
    expect(continued.action.type === 'spawn' && continued.action.followUp).toContain(
      'step 2 of the plan is still open',
    );
    expect(continued.state.completed).toEqual([0, 2]);
    expect(continued.state.retries).toBe(1);
  });

  it('continues on the step Jev finds not done and keeps the rest of the span done', () => {
    const plan = planned(['a', 'b']);
    const first = nextStep(plan.state, built()).state;
    const again = nextStep(first, judged(first, [0]));
    expect(again.action).toMatchObject({ type: 'spawn', reason: 'continue', stepIndex: 0 });
    expect(again.state.completed).toEqual([1]);
  });

  it('falls back to the markers once the retries are used up', () => {
    const plan = planned(['a', 'b', 'c']);
    const judging = nextStep(plan.state, built([0, 1, 2])).state;
    const spent = { ...judging, retries: MAX_REPAIR_RETRIES };
    expect(nextStep(spent, judged(spent, [1])).action).toEqual({ type: 'wrap_up' });
  });
});
