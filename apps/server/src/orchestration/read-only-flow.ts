import type { FlowResult, FlowState, Spawn } from './transitions.ts';

export function askAgent(state: FlowState): FlowResult {
  return {
    state: { ...state, depth: 'direct', phase: 'scouting', waitingFor: null },
    action: { type: 'ask_agent' },
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
