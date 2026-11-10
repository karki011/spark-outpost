export type LeadKind = 'meeting' | 'since-you-left' | 'before-you-go' | 'board';
export type LeadState = LeadKind | 'loading';

export const EVENING_FROM_HOUR = 17;
export const NIGHT_UNTIL_HOUR = 4;

export interface LeadInput {
  loading: boolean;
  now: number;
  meetingActive: boolean;
  awayUpdates: number;
  busy: number;
}

export function isEvening(now: number): boolean {
  const hour = new Date(now).getHours();
  return hour >= EVENING_FROM_HOUR || hour < NIGHT_UNTIL_HOUR;
}

export function pickLead(input: LeadInput): LeadState {
  if (input.loading) return 'loading';
  if (input.meetingActive) return 'meeting';
  if (input.awayUpdates > 0) return 'since-you-left';
  if (isEvening(input.now) && input.busy > 0) return 'before-you-go';
  return 'board';
}
