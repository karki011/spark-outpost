import type { CalendarMyStatus } from '@spark-outpost/contracts';

export type ReplyLook = 'filled' | 'dashed' | 'striped' | 'struck';

export interface ReplyState {
  look: ReplyLook;
  word: string | null;
}

const STATES: Record<CalendarMyStatus, ReplyState> = {
  accepted: { look: 'filled', word: 'Accepted' },
  none: { look: 'filled', word: null },
  pending: { look: 'dashed', word: 'Not answered' },
  tentative: { look: 'striped', word: 'Maybe' },
  declined: { look: 'struck', word: 'Declined' },
};

export function replyState(status: CalendarMyStatus): ReplyState {
  return STATES[status];
}
