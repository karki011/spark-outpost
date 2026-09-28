import type { FlowResult, FlowState, Spawn } from './transitions.ts';

export function writePlan(state: FlowState, note: string | null): FlowResult {
  return {
    state: { ...state, depth: 'direct', readOnly: 'plan', phase: 'planning', waitingFor: null },
    action: { type: 'plan', note },
  };
}

export function reviewExisting(state: FlowState): FlowResult {
  const critic: Spawn = { role: 'critic', reason: 'first', escalate: false, note: null };
  return {
    state: {
      ...state,
      depth: 'direct',
      readOnly: 'review',
      reviewWanted: true,
      reviewed: true,
      phase: 'reviewing',
      last: critic,
      waitingFor: null,
    },
    action: { type: 'spawn', ...critic },
  };
}
