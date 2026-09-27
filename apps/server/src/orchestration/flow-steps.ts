import type { AgentRole, OrchestrationPhase, TransitionNext } from '@spark-outpost/contracts';
import { plansFirst } from './depth.ts';
import { firstOpenStep, groupMembers, isResearchStep } from './parallel.ts';
import { carriedSteps, spanOf } from './spans.ts';
import type { FlowCheckpoint, FlowResult, FlowState, Spawn } from './transitions.ts';

const PHASE_FOR_ROLE: Record<AgentRole, OrchestrationPhase> = {
  scout: 'scouting',
  architect: 'planning',
  builder: 'building',
  critic: 'reviewing',
};

export function spawn(
  state: FlowState,
  next: Omit<Spawn, 'note'> & { note?: string | null },
): FlowResult {
  const full: Spawn = { ...next, note: next.note ?? null };
  return {
    state: {
      ...state,
      phase: PHASE_FOR_ROLE[full.role],
      last: full,
      lastGroup: null,
      waitingFor: null,
      ticked: [],
    },
    action: { type: 'spawn', ...full },
  };
}

export function spawnGroup(
  state: FlowState,
  stepIndexes: number[],
  lanes?: number[][],
): FlowResult {
  const stepIndex = stepIndexes[0]!;
  return {
    state: {
      ...state,
      phase: 'building',
      stepIndex,
      last: { ...first('builder', stepIndex), note: null },
      lastGroup: stepIndexes,
      waitingFor: null,
      ticked: [],
    },
    action: { type: 'spawn_group', stepIndexes, ...(lanes ? { lanes } : {}) },
  };
}

function openLanes(state: FlowState): number[][] {
  return state.lanes
    .map((lane) => lane.filter((index) => !state.completed.includes(index)))
    .filter((lane) => lane.length > 0);
}

export function laneOf(state: FlowState, stepIndex: number): number[] | null {
  return state.lanes.find((lane) => lane.includes(stepIndex)) ?? null;
}

export function spawnLanes(state: FlowState, stepIndex: number): FlowResult | null {
  if (!state.worktrees || !laneOf(state, stepIndex)) return null;
  const open = openLanes(state);
  if (open.length > 1)
    return spawnGroup(
      state,
      open.map((lane) => lane[0]!),
      open,
    );
  const lane = open[0];
  if (!lane) return null;
  return spawn(
    { ...state, stepIndex: lane[0]! },
    { ...first('builder', lane[0]!), ...(lane.length > 1 ? { carry: lane } : {}) },
  );
}

function sequentialGroups(state: FlowState): number[][] {
  return state.worktrees ? [...state.groups, ...state.lanes] : [];
}

export function spawnStep(state: FlowState, stepIndex: number): FlowResult {
  const lanes = spawnLanes(state, stepIndex);
  if (lanes) return lanes;
  const members = groupMembers(
    state.groups,
    state.completed,
    state.steps,
    stepIndex,
    state.worktrees,
  );
  const solo = members.length <= 1 && !isResearchStep(state.steps[stepIndex] ?? '');
  if (!solo) return spawnGroup(state, members.length > 0 ? members : [stepIndex]);
  const carry = carriedSteps(state.steps, sequentialGroups(state), state.completed, stepIndex);
  return spawn(
    { ...state, stepIndex },
    { ...first('builder', stepIndex), ...(carry.length > 1 ? { carry } : {}) },
  );
}

export function withDone(state: FlowState, steps: readonly number[]): FlowState {
  const added = steps.filter((step) => !state.completed.includes(step));
  return added.length > 0 ? { ...state, completed: [...state.completed, ...added] } : state;
}

export function markedSpan(span: readonly number[], ticked: readonly number[]): number[] {
  const marked = ticked.filter((index) => span.includes(index));
  if (marked.length === 0) return [...span];
  const last = Math.max(...marked);
  return span.filter((index) => index <= last);
}

export function withStepDone(state: FlowState): FlowState {
  if (state.last?.role !== 'builder') return state;
  const done = markedSpan(spanOf(state.last), state.ticked);
  return { ...withDone(state, done), stepIndex: Math.max(state.stepIndex, ...done) };
}

export function stepsLeftAfter(state: FlowState): boolean {
  if (state.last?.role !== 'builder') return false;
  const settled = withStepDone(state);
  return firstOpenStep(settled.steps, settled.completed) !== null;
}

function stepList(indexes: readonly number[]): string {
  const numbers = indexes.map((index) => String(index + 1));
  if (numbers.length === 1) return `step ${numbers[0]}`;
  return `steps ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

export function continueFollowUp(open: readonly number[]): string {
  const list = stepList(open);
  const markers = open.length > 1 ? ' Write "Step N done." on its own line after each one.' : '';
  return `You stopped before finishing: ${list} of the plan ${open.length === 1 ? 'is' : 'are'} still open. Continue with ${open.length === 1 ? 'it' : 'them'} now, in plan order.${markers} Then reply with what you changed.`;
}

export function continueOrSpawn(state: FlowState, stepIndex: number): FlowResult {
  const last = state.last;
  const partial = last?.role === 'builder' && state.ticked.length > 0;
  if (!partial || !spanOf(last).includes(stepIndex)) return spawnStep(state, stepIndex);
  const open = spanOf(last).filter((index) => !state.completed.includes(index));
  return spawn(
    { ...state, stepIndex },
    {
      role: 'builder',
      stepIndex,
      escalate: false,
      reason: 'continue',
      from: last.from ?? last.stepIndex,
      followUp: continueFollowUp(open),
      ...(open.length > 1 ? { carry: open } : {}),
    },
  );
}

export function incompleteLine(state: FlowState): string | null {
  const open = state.steps.flatMap((step, index) =>
    step.trim() && !state.completed.includes(index) ? [index] : [],
  );
  if (open.length === 0 || state.depth === 'direct') return null;
  const total = state.steps.length;
  const verb = open.length === 1 ? 'is' : 'are';
  return `Incomplete: ${stepList(open)} of ${total} ${verb} still open. Ask to continue and a Builder picks up from there.`;
}

export function ask(
  state: FlowState,
  kind: FlowCheckpoint,
  reason: string,
  suggestion: TransitionNext | null = null,
  fromJev = false,
): FlowResult {
  return {
    state: { ...state, phase: 'waiting', waitingFor: kind, suggestion },
    action: { type: 'ask', kind, reason, suggestion, fromJev },
  };
}

export function askInterpretation(state: FlowState, reason: string): FlowResult {
  return {
    state: { ...state, phase: 'waiting', waitingFor: 'clarify', suggestion: null },
    action: {
      type: 'ask',
      kind: 'clarify',
      reason,
      suggestion: null,
      fromJev: true,
      interpret: true,
    },
  };
}

export function finish(
  state: FlowState,
  status: 'succeeded' | 'failed' | 'cancelled',
  reason: string | null = null,
): FlowResult {
  const incomplete = status === 'succeeded' ? incompleteLine(state) : null;
  return {
    state: { ...state, phase: 'finished', waitingFor: null },
    action: { type: 'finish', status, reason, ...(incomplete ? { incomplete } : {}) },
  };
}

export function wrapUp(state: FlowState): FlowResult {
  return { state: { ...state, waitingFor: null }, action: { type: 'wrap_up' } };
}

export function firstAgent(state: FlowState): FlowResult {
  if (state.depth === 'direct') return spawn(state, first('scout', 0));
  if (plansFirst(state.depth)) return spawn(state, first('architect', 0));
  const steps = state.steps.length > 0 ? state.steps : [''];
  return spawn({ ...state, steps }, first('builder', 0));
}

export function first(role: AgentRole, stepIndex: number): Omit<Spawn, 'note'> {
  return { role, stepIndex, escalate: false, reason: 'first' };
}

export function startBuilding(state: FlowState): FlowResult {
  return spawnStep({ ...state, completed: [] }, 0);
}
