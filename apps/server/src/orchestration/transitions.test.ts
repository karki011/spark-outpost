import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_OPTION,
  MAX_REPAIR_RETRIES,
  type Depth,
  type InvolvementLevel,
  type Risk,
} from '@spark-outpost/contracts';
import { MAX_BUILDERS, batchSteps } from './parallel.ts';
import { ruleTransition } from './transition-choice.ts';
import {
  MAX_PLAN_EDITS,
  initialFlow,
  nextStep,
  type FlowEvent,
  type FlowResult,
  type FlowState,
} from './transitions.ts';

function run(state: FlowState, events: FlowEvent[]): FlowResult[] {
  const results: FlowResult[] = [];
  let current = state;
  for (const event of events) {
    const result = nextStep(current, event);
    results.push(result);
    current = result.state;
  }
  return results;
}

const flow = (depth: Depth, risk: Risk = 'edits', level: InvolvementLevel = 'hands-off') =>
  initialFlow(depth, risk, level);
const start: FlowEvent = { type: 'start', intake: 'act' };
const done = (role: 'scout' | 'architect' | 'builder' | 'critic', extra = {}): FlowEvent => ({
  type: 'agent_done',
  role,
  outcome: 'succeeded',
  ...extra,
});
const judged = (next: 'next_step' | 'retry_up' | 'review' | 'finish', extra = {}): FlowEvent => ({
  type: 'judged',
  status: 'done',
  next,
  rules: { status: 'done', next },
  source: 'jev',
  confidence: 0.95,
  ...extra,
});
const answer = (
  kind: 'clarify' | 'plan' | 'retry' | 'accept' | 'budget',
  optionId: string,
  note: string | null = null,
): FlowEvent => ({
  type: 'answered',
  kind,
  optionId,
  note,
});
const actions = (results: FlowResult[]) =>
  results.map(({ action }) =>
    action.type === 'spawn'
      ? `spawn ${action.role}:${action.carry ? action.carry.join('-') : action.stepIndex}${action.escalate ? '+' : ''}`
      : action.type === 'ask'
        ? `ask ${action.kind}`
        : action.type === 'finish'
          ? `finish ${action.status}`
          : action.type === 'judge'
            ? `judge ${action.role}`
            : action.type,
  );

describe('depth paths', () => {
  it('answers directly with a Scout', () => {
    expect(actions(run(flow('direct', 'read-only'), [start, done('scout')]))).toEqual([
      'spawn scout:0',
      'finish succeeded',
    ]);
  });

  it('executes with one Builder, judges it and wraps up', () => {
    expect(
      actions(
        run(flow('execute'), [
          start,
          done('builder'),
          judged('finish'),
          { type: 'wrapped', filesChanged: 1, asksToKeep: false },
        ]),
      ),
    ).toEqual(['spawn builder:0', 'judge builder', 'wrap_up', 'finish succeeded']);
  });

  it('plans, then one Builder carries every step in order and finishes without review', () => {
    const results = run(flow('plan_execute'), [
      start,
      done('architect', { steps: ['one', 'two'] }),
      done('builder'),
      judged('next_step'),
    ]);
    expect(actions(results)).toEqual([
      'spawn architect:0',
      'spawn builder:0-1',
      'judge builder',
      'wrap_up',
    ]);
    expect(results.at(-1)!.state).toMatchObject({ completed: [0, 1], stepIndex: 1 });
  });

  it('retries only the steps the carrying Builder had not marked done', () => {
    const results = run(flow('plan_execute'), [
      start,
      done('architect', { steps: ['one', 'two', 'three'] }),
      { type: 'agent_done', role: 'builder', outcome: 'failed', ticked: [0] },
      judged('retry_up', { status: 'needs_more_work' }),
      done('builder', { ticked: [1, 2] }),
      judged('next_step'),
    ]);
    expect(actions(results)).toEqual([
      'spawn architect:0',
      'spawn builder:0-1-2',
      'judge builder',
      'spawn builder:1-2+',
      'judge builder',
      'wrap_up',
    ]);
  });

  it('reviews after building when the depth asks for it, even if Jev says finish', () => {
    const results = run(flow('plan_execute_review'), [
      start,
      done('architect', { steps: ['one'] }),
      done('builder'),
      judged('finish'),
      done('critic', { verdict: 'looks_good' }),
      judged('finish'),
    ]);
    expect(actions(results)).toEqual([
      'spawn architect:0',
      'spawn builder:0',
      'judge builder',
      'spawn critic:0',
      'judge critic',
      'wrap_up',
    ]);
    expect(results.at(-1)!.state).toMatchObject({ reviewed: true, verdict: 'looks_good' });
  });

  it('treats an empty plan as one step for the whole request', () => {
    const [, built] = run(flow('plan_execute'), [start, done('architect', { steps: [] })]);
    expect(built!.state.steps).toEqual(['']);
  });

  it('never runs more Builders than the cap, batching the plan steps', () => {
    const steps = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(batchSteps(steps)).toHaveLength(MAX_BUILDERS);
    expect(batchSteps(steps).join('\n').split('\n')).toEqual(steps);
    expect(batchSteps([' a ', '', 'b'])).toEqual(['a', 'b']);
  });
});

describe('checkpoints by level', () => {
  it('asks to clarify when the intake gate says ask, and uses the chosen depth', () => {
    const results = run(flow('execute'), [
      { type: 'start', intake: 'ask' },
      { type: 'clarified', depth: 'plan_execute' },
    ]);
    expect(actions(results)).toEqual(['ask clarify', 'spawn architect:0']);
    expect(results[1]!.state.depth).toBe('plan_execute');
  });

  it('stops when you stop at the clarify card', () => {
    expect(
      actions(
        run(flow('execute'), [
          { type: 'start', intake: 'ask' },
          { type: 'clarified', depth: null },
        ]),
      ),
    ).toEqual(['ask clarify', 'finish cancelled']);
  });

  it.each([
    ['hands-on', 'edits', true],
    ['balanced', 'edits', false],
    ['balanced', 'multi-file', true],
    ['hands-off', 'multi-file', false],
    ['hands-off', 'destructive', true],
    ['full-auto', 'destructive', false],
  ] as const)('at %s with %s work, asks for the plan: %s', (level, risk, asks) => {
    const [, afterPlan] = run(flow('plan_execute', risk, level), [
      start,
      done('architect', { steps: ['one'] }),
    ]);
    expect(afterPlan!.action.type).toBe(asks ? 'ask' : 'spawn');
  });

  it('sends an edited plan back to the Architect with your note, up to a limit', () => {
    let state = run(flow('plan_execute', 'multi-file', 'balanced'), [
      start,
      done('architect', { steps: ['one'] }),
    ]).at(-1)!.state;
    for (let edit = 0; edit < MAX_PLAN_EDITS; edit++) {
      const result = nextStep(state, answer('plan', CHECKPOINT_OPTION.editPlan, 'smaller'));
      expect(result.action).toMatchObject({
        type: 'spawn',
        role: 'architect',
        note: 'smaller',
        reason: 'edit',
      });
      state = nextStep(result.state, done('architect', { steps: ['one'] })).state;
    }
    expect(
      nextStep(state, answer('plan', CHECKPOINT_OPTION.editPlan, 'again')).action,
    ).toMatchObject({
      type: 'spawn',
      role: 'builder',
    });
  });

  it('stops at the plan card', () => {
    const state = run(flow('plan_execute', 'multi-file', 'balanced'), [
      start,
      done('architect', { steps: ['one'] }),
    ]).at(-1)!.state;
    expect(nextStep(state, answer('plan', CHECKPOINT_OPTION.stop)).action).toMatchObject({
      type: 'finish',
      status: 'cancelled',
    });
  });

  it('asks to keep changes only when the wrap-up says so', () => {
    const base = run(flow('execute'), [start, done('builder'), judged('finish')]).at(-1)!.state;
    expect(
      nextStep(base, { type: 'wrapped', filesChanged: 2, asksToKeep: true }).action,
    ).toMatchObject({ type: 'ask', kind: 'accept' });
    expect(
      nextStep(base, { type: 'wrapped', filesChanged: 2, asksToKeep: false }).action,
    ).toMatchObject({ type: 'finish', status: 'succeeded' });
  });

  it('keeps, reverts, or sends a fix to a new Builder', () => {
    const waiting = nextStep(
      run(flow('execute'), [start, done('builder'), judged('finish')]).at(-1)!.state,
      { type: 'wrapped', filesChanged: 1, asksToKeep: true },
    ).state;
    expect(nextStep(waiting, answer('accept', CHECKPOINT_OPTION.keep)).action).toMatchObject({
      type: 'finish',
      status: 'succeeded',
    });
    expect(nextStep(waiting, answer('accept', CHECKPOINT_OPTION.revert)).action).toEqual({
      type: 'revert',
    });
    expect(
      nextStep(nextStep(waiting, answer('accept', CHECKPOINT_OPTION.revert)).state, {
        type: 'reverted',
      }).action,
    ).toMatchObject({ type: 'finish', status: 'succeeded' });
    expect(
      nextStep(waiting, answer('accept', CHECKPOINT_OPTION.fix, 'add a test')).action,
    ).toMatchObject({
      type: 'spawn',
      role: 'builder',
      reason: 'fix',
      escalate: false,
      note: 'add a test',
    });
  });
});

describe('repair and escalation', () => {
  const failed: FlowEvent = {
    type: 'agent_done',
    role: 'builder',
    outcome: 'failed',
    error: 'boom',
  };

  it('retries one tier up without asking at Hands-off, at most twice, then asks you', () => {
    const results = run(flow('execute'), [
      start,
      failed,
      judged('retry_up', { status: 'needs_more_work' }),
      failed,
      judged('retry_up', { status: 'needs_more_work' }),
      failed,
      judged('finish', { status: 'needs_more_work' }),
    ]);
    expect(actions(results)).toEqual([
      'spawn builder:0',
      'judge builder',
      'spawn builder:0+',
      'judge builder',
      'spawn builder:0+',
      'judge builder',
      'ask retry',
    ]);
    expect(results.at(-1)!.state.retries).toBe(MAX_REPAIR_RETRIES);
    expect(results.at(-1)!.action).toMatchObject({
      reason: `Stopped after ${MAX_REPAIR_RETRIES} retries.`,
    });
  });

  it.each([
    ['hands-on', 0.99, true],
    ['balanced', 0.95, false],
    ['balanced', 0.8, true],
    ['hands-off', 0.5, false],
    ['full-auto', 0.5, false],
  ] as const)('at %s with Jev at %s, confirms a retry: %s', (level, confidence, asks) => {
    const [, , result] = run(flow('execute', 'edits', level), [
      start,
      failed,
      judged('retry_up', { confidence }),
    ]);
    expect(result!.action.type).toBe(asks ? 'ask' : 'spawn');
  });

  it('always confirms a retry the rules chose under Balanced', () => {
    const [, , result] = run(flow('execute', 'edits', 'balanced'), [
      start,
      failed,
      judged('retry_up', { source: 'rules', confidence: null }),
    ]);
    expect(result!.action).toMatchObject({ type: 'ask', kind: 'retry' });
  });

  it('runs an unplanned review only after confirming it at Balanced', () => {
    const [, , asked] = run(flow('execute', 'edits', 'balanced'), [
      start,
      done('builder'),
      judged('review', { confidence: 0.8 }),
    ]);
    expect(asked!.action).toMatchObject({ type: 'ask', kind: 'retry', suggestion: 'review' });
    expect(nextStep(asked!.state, answer('retry', CHECKPOINT_OPTION.retry)).action).toMatchObject({
      type: 'spawn',
      role: 'critic',
    });
    expect(nextStep(asked!.state, answer('retry', CHECKPOINT_OPTION.finish)).action).toEqual({
      type: 'wrap_up',
    });
  });

  it('repairs after review concerns with a Builder one tier up', () => {
    const results = run(flow('plan_execute_review'), [
      start,
      done('architect', { steps: ['one', 'two'] }),
      done('builder'),
      judged('next_step'),
      done('builder'),
      judged('finish'),
      done('critic', { verdict: 'concerns' }),
      judged('retry_up', { status: 'needs_more_work' }),
    ]);
    expect(results.at(-1)!.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      stepIndex: 1,
      escalate: true,
    });
  });

  it('follows the rules when Jev is not used', () => {
    const state = run(flow('plan_execute_review'), [
      start,
      done('architect', { steps: ['a', 'b'] }),
    ]).at(-1)!.state;
    expect(ruleTransition(state, 'succeeded')).toEqual({ status: 'done', next: 'review' });
    const single = { ...state, last: { ...state.last!, carry: undefined } };
    expect(ruleTransition(single, 'succeeded')).toEqual({ status: 'done', next: 'next_step' });
    expect(ruleTransition({ ...single, stepIndex: 1 }, 'succeeded')).toEqual({
      status: 'done',
      next: 'review',
    });
    expect(ruleTransition({ ...state, retries: MAX_REPAIR_RETRIES }, 'failed')).toEqual({
      status: 'needs_you',
      next: 'finish',
    });
    expect(ruleTransition(state, 'failed')).toEqual({
      status: 'needs_more_work',
      next: 'retry_up',
    });
  });
});

describe('stop, failure and budgets', () => {
  it('finishes cancelled when stopped at any point', () => {
    expect(nextStep(flow('execute'), { type: 'stopped' }).action).toMatchObject({
      type: 'finish',
      status: 'cancelled',
    });
    expect(
      nextStep(flow('execute'), { type: 'agent_done', role: 'builder', outcome: 'cancelled' })
        .action,
    ).toMatchObject({ status: 'cancelled' });
  });

  it('fails with the agent error when a Scout or Architect fails', () => {
    expect(
      nextStep(flow('direct'), {
        type: 'agent_done',
        role: 'scout',
        outcome: 'failed',
        error: 'no model',
      }).action,
    ).toEqual({
      type: 'finish',
      status: 'failed',
      reason: 'no model',
    });
    expect(
      nextStep(flow('plan_execute'), { type: 'agent_done', role: 'architect', outcome: 'failed' })
        .action,
    ).toMatchObject({ status: 'failed' });
  });

  it('asks before continuing past a budget and resumes the steps still open', () => {
    const building = run(flow('plan_execute'), [
      start,
      done('architect', { steps: ['a', 'b', 'c'] }),
    ]).at(-1)!.state;
    const asked = nextStep(building, {
      type: 'budget_exceeded',
      limit: 'tool_calls',
      ticked: [0],
    });
    expect(asked.action).toMatchObject({
      type: 'ask',
      kind: 'budget',
      reason: 'The tool calls budget ran out.',
    });
    expect(
      nextStep(asked.state, answer('budget', CHECKPOINT_OPTION.continueBudget)).action,
    ).toMatchObject({
      type: 'spawn',
      role: 'builder',
      stepIndex: 1,
      carry: [1, 2],
      reason: 'resume',
      escalate: false,
    });
    expect(nextStep(asked.state, answer('budget', CHECKPOINT_OPTION.stop)).action).toEqual({
      type: 'finish',
      status: 'failed',
      reason: 'Stopped: the tool calls budget ran out.',
    });
  });
});
