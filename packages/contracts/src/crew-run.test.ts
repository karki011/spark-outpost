import { describe, expect, it } from 'vitest';
import {
  planWorkflow,
  previewWorkflow,
  workflowOutcome,
  type RunStep,
  type WorkflowStepState,
} from './crew-run.ts';

function step(id: string, dependsOn: string[] = [], rest: Partial<RunStep> = {}): RunStep {
  return { id, dependsOn, join: 'all', onFailure: 'stop', ...rest };
}

const review = [
  step('security'),
  step('lint'),
  step('types'),
  step('comment', ['security', 'lint', 'types']),
  step('ticketing', ['comment']),
];

describe('planWorkflow', () => {
  it('starts every step with no parents together', () => {
    expect(planWorkflow(review, {})).toEqual({
      start: ['security', 'lint', 'types'],
      skip: [],
      stoppedBy: null,
      finished: false,
    });
  });

  it('waits for all parents by default', () => {
    const states: Record<string, WorkflowStepState> = {
      security: 'succeeded',
      lint: 'succeeded',
      types: 'running',
    };
    expect(planWorkflow(review, states).start).toEqual([]);
    expect(planWorkflow(review, { ...states, types: 'succeeded' }).start).toEqual(['comment']);
  });

  it('starts an any-join step as soon as one parent finishes', () => {
    const steps = [step('a'), step('b'), step('c', ['a', 'b'], { join: 'any' })];
    expect(planWorkflow(steps, { a: 'succeeded', b: 'running' }).start).toEqual(['c']);
  });

  it('stops starting steps after a stop failure and finishes when nothing runs', () => {
    const running = planWorkflow(review, {
      security: 'running',
      lint: 'failed',
      types: 'succeeded',
    });
    expect(running).toEqual({
      start: [],
      skip: ['comment', 'ticketing'],
      stoppedBy: 'lint',
      finished: false,
    });
    const settled = planWorkflow(review, {
      security: 'succeeded',
      lint: 'failed',
      types: 'succeeded',
      comment: 'skipped',
      ticketing: 'skipped',
    });
    expect(settled.finished).toBe(true);
  });

  it('carries on past a failure set to continue', () => {
    const steps = [step('lint', [], { onFailure: 'continue' }), step('comment', ['lint'])];
    expect(planWorkflow(steps, { lint: 'failed' })).toEqual({
      start: ['comment'],
      skip: [],
      stoppedBy: null,
      finished: false,
    });
  });

  it('skips the rest after a cancel', () => {
    const plan = planWorkflow(review, {
      security: 'cancelled',
      lint: 'succeeded',
      types: 'succeeded',
    });
    expect(plan.start).toEqual([]);
    expect(plan.skip).toEqual(['comment', 'ticketing']);
    expect(plan.finished).toBe(true);
  });

  it('ends a workflow whose steps wait on each other', () => {
    const plan = planWorkflow([step('x', ['y']), step('y', ['x'])], {});
    expect(plan).toEqual({ start: [], skip: ['x', 'y'], stoppedBy: null, finished: true });
  });

  it('is finished once every step has settled', () => {
    expect(planWorkflow([step('a')], { a: 'succeeded' }).finished).toBe(true);
  });
});

describe('previewWorkflow', () => {
  it('plays the stages in order', () => {
    const preview = previewWorkflow(review, new Set());
    expect(preview.rounds).toEqual([['security', 'lint', 'types'], ['comment'], ['ticketing']]);
    expect(preview.stoppedBy).toBeNull();
    expect(Object.values(preview.states).every((state) => state === 'succeeded')).toBe(true);
  });

  it('lets siblings finish and skips the rest when a step stops the workflow', () => {
    const preview = previewWorkflow(review, new Set(['types']));
    expect(preview.rounds).toEqual([['security', 'lint', 'types']]);
    expect(preview.stoppedBy).toBe('types');
    expect(preview.states).toEqual({
      security: 'succeeded',
      lint: 'succeeded',
      types: 'failed',
      comment: 'skipped',
      ticketing: 'skipped',
    });
  });

  it('keeps going when the failing step is set to continue', () => {
    const steps = review.map((item) =>
      item.id === 'types' ? { ...item, onFailure: 'continue' as const } : item,
    );
    const preview = previewWorkflow(steps, new Set(['types']));
    expect(preview.rounds).toHaveLength(3);
    expect(preview.states.ticketing).toBe('succeeded');
  });
});

describe('workflowOutcome', () => {
  it('fails only when a stop failure happened', () => {
    const steps = [step('a', [], { onFailure: 'continue' }), step('b')];
    expect(workflowOutcome(steps, { a: 'failed', b: 'succeeded' })).toBe('succeeded');
    expect(workflowOutcome(steps, { a: 'succeeded', b: 'failed' })).toBe('failed');
    expect(workflowOutcome(steps, { a: 'cancelled', b: 'failed' })).toBe('cancelled');
  });
});
