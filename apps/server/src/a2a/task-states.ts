import { TaskState } from '@a2a-js/sdk';
import type { ClosedState, RequestState } from '@spark-outpost/contracts';

export function toA2aState(state: RequestState, closedState: ClosedState | null): TaskState {
  switch (state) {
    case 'sent':
      return TaskState.TASK_STATE_SUBMITTED;
    case 'working':
      return TaskState.TASK_STATE_WORKING;
    case 'needs_you':
      return TaskState.TASK_STATE_INPUT_REQUIRED;
    case 'answered':
      return TaskState.TASK_STATE_COMPLETED;
    case 'failed':
      return closedState === 'rejected'
        ? TaskState.TASK_STATE_REJECTED
        : TaskState.TASK_STATE_FAILED;
    case 'cancelled':
      return TaskState.TASK_STATE_CANCELED;
  }
}

export function fromA2aState(state: TaskState): RequestState {
  switch (state) {
    case TaskState.TASK_STATE_SUBMITTED:
      return 'sent';
    case TaskState.TASK_STATE_WORKING:
      return 'working';
    case TaskState.TASK_STATE_INPUT_REQUIRED:
      return 'needs_you';
    case TaskState.TASK_STATE_COMPLETED:
      return 'answered';
    case TaskState.TASK_STATE_CANCELED:
      return 'cancelled';
    case TaskState.TASK_STATE_FAILED:
    case TaskState.TASK_STATE_REJECTED:
    case TaskState.TASK_STATE_AUTH_REQUIRED:
    case TaskState.TASK_STATE_UNSPECIFIED:
    case TaskState.UNRECOGNIZED:
      return 'failed';
  }
}

const FINISHED: ReadonlySet<TaskState> = new Set([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_REJECTED,
  TaskState.TASK_STATE_CANCELED,
]);

export function isFinished(state: TaskState): boolean {
  return FINISHED.has(state);
}

export function wasDelivered(state: TaskState): boolean {
  return state !== TaskState.TASK_STATE_REJECTED;
}
