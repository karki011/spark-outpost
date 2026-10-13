import {
  friendlyStep,
  type NativeTerminalStep,
  type NativeTerminalTurn,
} from '@spark-outpost/contracts';

export type StepState = 'done' | 'active' | 'failed' | 'unknown';

export interface StepRow {
  id: string;
  name: string;
  state: StepState;
  time: string;
  subagent: boolean;
}

const LIVE = new Set(['queued', 'running', 'awaiting_approval']);

function stepState(step: NativeTerminalStep, live: boolean): StepState {
  if (step.failed) return 'failed';
  if (step.endedAt !== null) return 'done';
  return live ? 'active' : 'unknown';
}

export function stepDuration(step: Pick<NativeTerminalStep, 'startedAt' | 'endedAt'>): string {
  if (step.startedAt === null || step.endedAt === null) return '';
  const ms = Math.max(0, Date.parse(step.endedAt) - Date.parse(step.startedAt));
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function stepRows(turn: NativeTerminalTurn): StepRow[] {
  const live = LIVE.has(turn.status);
  return turn.steps.map((step) => ({
    id: step.id,
    name: friendlyStep(step.name),
    state: stepState(step, live),
    time: stepDuration(step),
    subagent: step.agentId !== null,
  }));
}

export const STEP_STATE_NAMES: Record<StepState, string> = {
  done: 'Done',
  active: 'Running',
  failed: 'Failed',
  unknown: 'End not observed',
};
