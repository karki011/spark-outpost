import type { RequestState } from '@spark-outpost/contracts';

export type ThreadStatus = 'waiting' | 'working' | 'held' | 'review' | 'idle' | 'done';

export type PullMark = 'open' | 'draft' | 'merged' | 'closed';

export const GROUP_LABELS: Record<ThreadStatus, string> = {
  waiting: 'Waiting on you',
  working: 'Working',
  held: 'Held',
  review: 'Ready for review',
  idle: 'Idle',
  done: 'Resolved',
};

const PILL_LABELS: Record<ThreadStatus, string> = {
  ...GROUP_LABELS,
  done: 'Done',
};

function answeredStatus(pull: PullMark | null): ThreadStatus {
  if (pull === null) return 'idle';
  return pull === 'open' || pull === 'draft' ? 'review' : 'done';
}

export function requestStatus(state: RequestState, pull: PullMark | null): ThreadStatus {
  switch (state) {
    case 'needs_you':
    case 'failed':
      return 'waiting';
    case 'working':
    case 'sent':
      return 'working';
    case 'cancelled':
      return 'done';
    case 'answered':
      return answeredStatus(pull);
  }
}

export function statusLabel(state: RequestState, status: ThreadStatus): string {
  if (status === 'held') return 'Held';
  if (state === 'failed') return 'Failed';
  if (state === 'cancelled') return 'Cancelled';
  if (state === 'sent') return 'Queued';
  return PILL_LABELS[status];
}
