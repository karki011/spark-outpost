import { TaskState } from '@a2a-js/sdk';
import type { ClosedState, RequestState } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { fromA2aState, isFinished, toA2aState, wasDelivered } from '../src/a2a/task-states.ts';

const TABLE: [RequestState, ClosedState | null, TaskState][] = [
  ['sent', null, TaskState.TASK_STATE_SUBMITTED],
  ['working', null, TaskState.TASK_STATE_WORKING],
  ['needs_you', null, TaskState.TASK_STATE_INPUT_REQUIRED],
  ['answered', null, TaskState.TASK_STATE_COMPLETED],
  ['failed', null, TaskState.TASK_STATE_FAILED],
  ['failed', 'failed', TaskState.TASK_STATE_FAILED],
  ['failed', 'rejected', TaskState.TASK_STATE_REJECTED],
  ['cancelled', null, TaskState.TASK_STATE_CANCELED],
  ['cancelled', 'cancelled', TaskState.TASK_STATE_CANCELED],
];

describe('A2A task states', () => {
  it.each(TABLE)('writes %s (closed: %s) as its task state', (state, closed, expected) => {
    expect(toA2aState(state, closed)).toBe(expected);
  });

  it.each(TABLE)('reads the task state of %s (closed: %s) back', (state, closed, wire) => {
    expect(fromA2aState(wire)).toBe(state);
    expect(fromA2aState(toA2aState(state, closed))).toBe(state);
  });

  it('shows a request that never ran as Failed, with no seventh word', () => {
    expect(fromA2aState(TaskState.TASK_STATE_REJECTED)).toBe('failed');
  });

  it.each([
    TaskState.TASK_STATE_UNSPECIFIED,
    TaskState.UNRECOGNIZED,
    TaskState.TASK_STATE_AUTH_REQUIRED,
  ])('reads state %s, which Spark never produces, as Failed', (state) => {
    expect(fromA2aState(state)).toBe('failed');
  });

  it('never produces auth required, unspecified or unrecognized', () => {
    const produced = new Set(TABLE.map(([state, closed]) => toA2aState(state, closed)));
    expect(produced.has(TaskState.TASK_STATE_AUTH_REQUIRED)).toBe(false);
    expect(produced.has(TaskState.TASK_STATE_UNSPECIFIED)).toBe(false);
    expect(produced.has(TaskState.UNRECOGNIZED)).toBe(false);
  });

  it('counts answered, failed, rejected and cancelled as finished', () => {
    const finished = TABLE.map(([, , wire]) => wire).filter(isFinished);
    expect(new Set(finished)).toEqual(
      new Set([
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_REJECTED,
        TaskState.TASK_STATE_CANCELED,
      ]),
    );
    expect(isFinished(TaskState.TASK_STATE_INPUT_REQUIRED)).toBe(false);
  });

  it('treats only a rejected task as not delivered', () => {
    expect(wasDelivered(TaskState.TASK_STATE_REJECTED)).toBe(false);
    expect(wasDelivered(TaskState.TASK_STATE_SUBMITTED)).toBe(true);
    expect(wasDelivered(TaskState.TASK_STATE_FAILED)).toBe(true);
  });
});
