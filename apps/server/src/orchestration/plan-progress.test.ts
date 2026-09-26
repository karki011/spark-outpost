import { describe, expect, it } from 'vitest';
import { MAX_REPAIR_RETRIES, type PlanEntry } from '@spark-outpost/contracts';
import { nextPlanWrite } from '../tasks/plan-versions.ts';
import { entriesForStep, markStep, statusAfterJudging, stepMarkers } from './plan-progress.ts';
import { batchSteps } from './parallel.ts';
import { initialFlow, nextStep, type FlowEvent, type FlowState } from './transitions.ts';

const plan = (count: number): PlanEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    content: `Update step ${index + 1}`,
    priority: 'medium',
    status: 'pending',
  }));

const statuses = (entries: readonly PlanEntry[]) => entries.map((entry) => entry.status);

function building(stepIndex: number, retries = 0): FlowState {
  const steps = batchSteps(plan(3).map((entry) => entry.content));
  const state = {
    ...initialFlow('plan_execute', 'edits', 'hands-off'),
    phase: 'building' as const,
  };
  return {
    ...state,
    steps,
    stepIndex,
    retries,
    last: { role: 'builder', stepIndex, escalate: false, note: null, reason: 'first' },
  };
}

const judged = (status: 'done' | 'needs_more_work', next: 'next_step' | 'retry_up'): FlowEvent => ({
  type: 'judged',
  status,
  next,
  rules: { status, next },
  source: 'rules',
  confidence: null,
});

const builder = (outcome: 'succeeded' | 'failed') => ({ role: 'builder' as const, outcome });

describe('stepMarkers', () => {
  it('reads the steps a carrying Builder marked done', () => {
    expect(stepMarkers('Edited a.ts.\nStep 1 done.\nThen **Step 3 done**\nstep 2 done')).toEqual([
      0, 2, 1,
    ]);
    expect(stepMarkers('Step 1 is not done yet')).toEqual([]);
  });
});

describe('entriesForStep', () => {
  it('maps each Builder step to the plan entry at the same index', () => {
    expect([0, 1, 2].map((step) => entriesForStep(plan(3), step))).toEqual([[0], [1], [2]]);
    expect(entriesForStep(plan(3), 3)).toEqual([]);
  });

  it('maps a batched Builder step to every entry in its batch', () => {
    const entries = plan(6);
    expect(batchSteps(entries.map((entry) => entry.content))).toHaveLength(3);
    expect([0, 1, 2].map((step) => entriesForStep(entries, step))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
});

describe('markStep', () => {
  it('moves one step through in progress and completed without touching the others', () => {
    const started = markStep(plan(3), 1, 'in_progress');
    expect(statuses(started)).toEqual(['pending', 'in_progress', 'pending']);
    expect(statuses(markStep(started, 1, 'completed'))).toEqual([
      'pending',
      'completed',
      'pending',
    ]);
  });

  it('marks every entry of a batched step', () => {
    expect(statuses(markStep(plan(5), 0, 'failed'))).toEqual([
      'failed',
      'failed',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('writes status changes as a new version that does not supersede the plan', () => {
    const latest = { version: 4, entries: plan(4) };
    expect(nextPlanWrite(latest, markStep(latest.entries, 0, 'in_progress'))).toEqual({
      version: 5,
      overwrite: false,
      supersedesPrevious: false,
    });
    const allDone = [0, 1, 2, 3].reduce(
      (entries, step) => markStep(entries, step, 'completed'),
      latest.entries,
    );
    expect(nextPlanWrite(latest, allDone)?.supersedesPrevious).toBe(false);
  });
});

describe('statusAfterJudging', () => {
  it('completes a successful step once the flow moves on', () => {
    const event = judged('done', 'next_step');
    const { action } = nextStep(building(0), event);
    expect(action).toMatchObject({ type: 'spawn', role: 'builder', stepIndex: 1 });
    expect(statusAfterJudging(event, action, builder('succeeded'))).toBe('completed');
  });

  it('completes the last step when the flow hands over to review or wrap up', () => {
    const event = judged('done', 'next_step');
    const { action } = nextStep(building(2), event);
    expect(action.type).not.toBe('spawn');
    expect(statusAfterJudging(event, action, builder('succeeded'))).toBe('completed');
  });

  it('leaves a retried step for the retry to restart', () => {
    const event = judged('needs_more_work', 'retry_up');
    const { action } = nextStep(building(1), event);
    expect(action).toMatchObject({ type: 'spawn', reason: 'retry', stepIndex: 1 });
    expect(statusAfterJudging(event, action, builder('succeeded'))).toBeNull();
    expect(statusAfterJudging(event, action, builder('failed'))).toBeNull();
  });

  it('fails the step when retries are exhausted and the flow asks you', () => {
    const event = judged('needs_more_work', 'retry_up');
    const { action } = nextStep(building(1, MAX_REPAIR_RETRIES), event);
    expect(action).toMatchObject({ type: 'ask', kind: 'retry' });
    expect(statusAfterJudging(event, action, builder('succeeded'))).toBe('failed');
  });

  it('never completes a failed Builder and ignores other agents and events', () => {
    const event = judged('done', 'next_step');
    const { action } = nextStep(building(0), event);
    expect(statusAfterJudging(event, action, builder('failed'))).toBeNull();
    expect(statusAfterJudging(event, action, { role: 'critic', outcome: 'succeeded' })).toBeNull();
    expect(statusAfterJudging({ type: 'stopped' }, action, builder('succeeded'))).toBeNull();
    expect(statusAfterJudging(event, action, undefined)).toBeNull();
  });
});
