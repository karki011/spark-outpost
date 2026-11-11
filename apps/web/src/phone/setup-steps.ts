import type { TailscaleStatus } from '@spark-outpost/contracts';

export type SetupStepId = 'tailscale' | 'https' | 'turn-on';
export type SetupStepState = 'done' | 'needs_you' | 'next' | 'later';

export interface SetupStep {
  id: SetupStepId;
  state: SetupStepState;
}

const STATES: Partial<Record<TailscaleStatus, [SetupStepState, SetupStepState, SetupStepState]>> = {
  not_installed: ['needs_you', 'next', 'later'],
  signed_out: ['needs_you', 'next', 'later'],
  https_off: ['done', 'needs_you', 'next'],
  off: ['done', 'done', 'needs_you'],
};

const IDS: SetupStepId[] = ['tailscale', 'https', 'turn-on'];

export function setupSteps(status: TailscaleStatus): SetupStep[] | null {
  const states = STATES[status];
  if (!states) return null;
  return IDS.map((id, index) => ({ id, state: states[index] ?? 'later' }));
}

export const STEP_STATE_WORDS: Record<SetupStepState, string> = {
  done: 'Done',
  needs_you: 'Needs you',
  next: 'Next',
  later: 'Later',
};
