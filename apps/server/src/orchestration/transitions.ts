import {
  CHECKPOINT_OPTION,
  MAX_REPAIR_RETRIES,
  type AgentRole,
  type BudgetLimit,
  type CheckpointKind,
  type Depth,
  type InvolvementLevel,
  type OrchestrationPhase,
  type ReviewVerdict,
  type Risk,
  type TransitionNext,
  type TransitionStatus,
} from '@spark-outpost/contracts';
import { asksForPlan } from './checkpoint-policy.ts';
import { VAGUE_REASON } from './clarify.ts';
import { reviewWanted } from './depth.ts';
import {
  ask,
  askInterpretation,
  finish,
  first,
  firstAgent,
  laneOf,
  continueOrSpawn,
  incompleteLine,
  markedSpan,
  spawn,
  spawnGroup,
  spawnLanes,
  startBuilding,
  stepsLeftAfter,
  withDone,
  withStepDone,
  wrapUp,
} from './flow-steps.ts';
import { batchGroups, batchRanges, batchSteps, firstOpenStep } from './parallel.ts';
import { chooseGroups, type ParallelVerdicts } from './parallel-choice.ts';
import { openSpan } from './spans.ts';
import { stopsForUser, wantsConfirm, type Transition } from './transition-choice.ts';

export const MAX_PLAN_EDITS = 3;

export type SpawnReason = 'first' | 'retry' | 'fix' | 'edit' | 'resume' | 'answer' | 'continue';

export type FlowCheckpoint = CheckpointKind | 'needs_input';

export interface Spawn {
  role: AgentRole;
  stepIndex: number;
  escalate: boolean;
  note: string | null;
  reason: SpawnReason;
  conflict?: string;
  carry?: number[] | undefined;
  followUp?: string;
  checkFailures?: string;
  from?: number;
}

export type FlowAction =
  | {
      type: 'ask';
      kind: FlowCheckpoint;
      reason: string;
      suggestion: TransitionNext | null;
      fromJev: boolean;
      blocked?: boolean;
      interpret?: boolean;
    }
  | ({ type: 'spawn' } & Spawn)
  | { type: 'spawn_group'; stepIndexes: number[]; lanes?: number[][] }
  | { type: 'judge'; role: AgentRole; stepIndex: number }
  | { type: 'wrap_up' }
  | { type: 'revert' }
  | {
      type: 'finish';
      status: 'succeeded' | 'failed' | 'cancelled';
      reason: string | null;
      incomplete?: string;
    };

export type AgentOutcome = 'succeeded' | 'failed' | 'cancelled';

export type FlowEvent =
  | { type: 'start'; intake: 'act' | 'ask' | 'fallback' | 'interpret' }
  | { type: 'clarified'; depth: Depth | null }
  | {
      type: 'agent_done';
      role: AgentRole;
      outcome: AgentOutcome;
      error?: string | null;
      steps?: readonly string[];
      groups?: readonly number[][];
      large?: readonly number[];
      parallel?: ParallelVerdicts;
      lanes?: readonly number[][];
      ticked?: readonly number[];
      verdict?: ReviewVerdict;
    }
  | {
      type: 'judged';
      status: TransitionStatus;
      next: TransitionNext;
      rules: Transition;
      source: 'jev' | 'rules';
      confidence: number | null;
    }
  | { type: 'answered'; kind: FlowCheckpoint; optionId: string; note: string | null }
  | { type: 'wrapped'; filesChanged: number; asksToKeep: boolean }
  | { type: 'reverted' }
  | { type: 'budget_exceeded'; limit: BudgetLimit; ticked?: readonly number[] }
  | { type: 'group_done'; results: GroupResult[]; stopped: boolean }
  | { type: 'stopped' };

export interface GroupResult {
  stepIndex: number;
  outcome: AgentOutcome;
  ticked?: readonly number[];
}

export interface FlowState {
  depth: Depth;
  risk: Risk;
  level: InvolvementLevel;
  phase: OrchestrationPhase;
  steps: string[];
  stepIndex: number;
  retries: number;
  planEdits: number;
  reviewed: boolean;
  verdict: ReviewVerdict | null;
  last: Spawn | null;
  suggestion: TransitionNext | null;
  fallback: Transition | null;
  waitingFor: FlowCheckpoint | null;
  exceeded: BudgetLimit | null;
  groups: number[][];
  completed: number[];
  worktrees: boolean;
  lastGroup: number[] | null;
  lanes: number[][];
  ranges: number[][] | null;
  reviewIntent: boolean;
  ticked: number[];
}

export interface FlowResult {
  state: FlowState;
  action: FlowAction;
}

export function initialFlow(
  depth: Depth,
  risk: Risk,
  level: InvolvementLevel,
  worktrees = false,
  reviewIntent = false,
): FlowState {
  return {
    depth,
    risk,
    level,
    phase: 'intake',
    steps: [],
    stepIndex: 0,
    retries: 0,
    planEdits: 0,
    reviewed: false,
    verdict: null,
    last: null,
    suggestion: null,
    fallback: null,
    waitingFor: null,
    exceeded: null,
    groups: [],
    completed: [],
    worktrees,
    lastGroup: null,
    lanes: [],
    ranges: null,
    reviewIntent,
    ticked: [],
  };
}

function planned(
  state: FlowState,
  raw: readonly string[],
  hinted: readonly number[][],
  large: readonly number[],
  verdicts: ParallelVerdicts | null,
  lanes: readonly (readonly number[])[],
): FlowState {
  const kept = raw.map((step) => step.trim()).filter(Boolean);
  if (state.worktrees && lanes.length > 1) {
    return {
      ...state,
      steps: kept,
      groups: [],
      lanes: lanes.map((lane) => [...lane]),
      ranges: kept.map((_, index) => [index]),
    };
  }
  const steps = batchSteps(kept);
  const worth = chooseGroups(kept, hinted, large, verdicts).groups;
  const groups = batchGroups(worth, batchRanges(kept.length));
  return { ...state, steps: steps.length > 0 ? steps : [''], groups, lanes: [], ranges: null };
}

function review(state: FlowState): FlowResult {
  return spawn({ ...state, reviewed: true }, first('critic', 0));
}

function afterWork(state: FlowState): FlowResult {
  if (reviewWanted(state) && !state.reviewed) return review(state);
  return wrapUp(state);
}

function retry(state: FlowState, note: string | null = null): FlowResult {
  const span =
    state.last?.role === 'builder'
      ? openSpan(state.last, state.completed)
      : { stepIndex: state.stepIndex };
  return spawn(
    { ...state, retries: state.retries + 1, stepIndex: span.stepIndex },
    { role: 'builder', escalate: true, reason: 'retry', note, ...span },
  );
}

function follow(current: FlowState, next: TransitionNext): FlowResult {
  if (next === 'retry_up') return retry(current);
  const state = withStepDone(current);
  if (next === 'review') return state.reviewed ? wrapUp(state) : review(state);
  if (next === 'next_step' && state.last?.role === 'builder') {
    const stepIndex = firstOpenStep(state.steps, state.completed);
    if (stepIndex !== null) return continueOrSpawn(state, stepIndex);
  }
  return afterWork(state);
}

function groupDone(state: FlowState, event: Extract<FlowEvent, { type: 'group_done' }>) {
  if (event.stopped) return finish(state, 'cancelled', 'You stopped it.');
  if (event.results.some((result) => result.outcome === 'cancelled')) {
    return finish(state, 'cancelled', 'Stopped.');
  }
  const spanFor = (head: number) => {
    const lane = laneOf(state, head);
    return lane
      ? lane.filter((index) => index >= head && !state.completed.includes(index))
      : [head];
  };
  const done = event.results.flatMap((result) =>
    result.outcome === 'succeeded'
      ? markedSpan(spanFor(result.stepIndex), result.ticked ?? [])
      : (result.ticked ?? []),
  );
  const completed = [...state.completed, ...done.filter((i) => !state.completed.includes(i))];
  const failed = event.results
    .filter((result) => result.outcome === 'failed')
    .map((result) => result.stepIndex)
    .sort((a, b) => a - b);
  const stepIndex =
    failed[0] ?? Math.max(...event.results.flatMap((result) => spanFor(result.stepIndex)));
  const open =
    failed[0] === undefined ? [] : spanFor(failed[0]).filter((i) => !completed.includes(i));
  const next: FlowState = {
    ...state,
    completed,
    stepIndex,
    last: {
      ...first('builder', stepIndex),
      note: null,
      ...(open.length > 1 ? { carry: open } : {}),
    },
    lastGroup: null,
    ticked: [],
  };
  if (failed.length === 0) return follow(next, 'next_step');
  const rules: Transition = { status: 'needs_more_work', next: 'retry_up' };
  return judged(next, { type: 'judged', ...rules, rules, source: 'rules', confidence: null });
}

function askUser(state: FlowState, status: 'needs_you' | 'blocked', rules: Transition) {
  const waiting = ask({ ...state, fallback: rules }, 'needs_input', status, null, true);
  return { ...waiting, action: { ...waiting.action, blocked: status === 'blocked' } };
}

function byRules(state: FlowState, rules: Transition): FlowResult {
  const cleared = { ...state, fallback: null };
  return judged(cleared, { type: 'judged', ...rules, rules, source: 'rules', confidence: null });
}

function answerAgent(state: FlowState, note: string): FlowResult {
  const cleared = { ...state, fallback: null };
  if (state.last?.role === 'builder') {
    return spawn(cleared, { ...state.last, escalate: false, reason: 'answer', note });
  }
  const stepIndex = Math.max(0, state.steps.length - 1);
  return spawn(
    { ...cleared, stepIndex },
    { role: 'builder', stepIndex, escalate: false, reason: 'answer', note },
  );
}

function judged(state: FlowState, event: Extract<FlowEvent, { type: 'judged' }>): FlowResult {
  if (event.source === 'jev' && stopsForUser(event.status)) {
    return askUser(state, event.status, event.rules);
  }
  let next = event.next;
  if (next === 'finish' && state.last?.role === 'builder') next = 'next_step';
  if (next === 'review' && stepsLeftAfter(state)) next = 'next_step';
  const exhausted = state.retries >= MAX_REPAIR_RETRIES;
  if (exhausted && (next === 'retry_up' || event.status !== 'done')) {
    return ask(state, 'retry', `Stopped after ${MAX_REPAIR_RETRIES} retries.`, 'retry_up');
  }
  if (wantsConfirm(state, next, event.source === 'jev' ? event.confidence : null)) {
    const reason =
      next === 'retry_up' ? 'Jev suggests a retry one tier up.' : 'Jev suggests a review.';
    return ask(state, 'retry', reason, next, event.source === 'jev');
  }
  return follow(state, next);
}

function agentDone(
  state: FlowState,
  event: Extract<FlowEvent, { type: 'agent_done' }>,
): FlowResult {
  if (event.outcome === 'cancelled') return finish(state, 'cancelled', 'Stopped.');
  if (event.role === 'scout') {
    return event.outcome === 'succeeded'
      ? finish(state, 'succeeded')
      : finish(state, 'failed', event.error ?? 'The Scout hit a problem.');
  }
  if (event.role === 'architect') {
    if (event.outcome === 'failed')
      return finish(state, 'failed', event.error ?? 'The Architect hit a problem.');
    const next = planned(
      state,
      event.steps ?? [],
      event.groups ?? [],
      event.large ?? [],
      event.parallel ?? null,
      event.lanes ?? [],
    );
    if (asksForPlan(state.level, state.risk)) return ask(next, 'plan', 'Approve the plan.');
    return startBuilding(next);
  }
  if (event.role === 'critic') {
    const verdict = event.verdict ?? 'unclear';
    return {
      state: { ...state, verdict },
      action: { type: 'judge', role: 'critic', stepIndex: state.stepIndex },
    };
  }
  const ticked = { ...withDone(state, event.ticked ?? []), ticked: [...(event.ticked ?? [])] };
  return { state: ticked, action: { type: 'judge', role: 'builder', stepIndex: state.stepIndex } };
}

function answered(state: FlowState, event: Extract<FlowEvent, { type: 'answered' }>): FlowResult {
  const option = event.optionId;
  if (event.kind === 'budget') {
    if (option === CHECKPOINT_OPTION.continueBudget && state.lastGroup) {
      const resumed = { ...state, exceeded: null };
      const lanes = spawnLanes(resumed, state.lastGroup[0]!);
      if (lanes) return lanes;
      const open = state.lastGroup.filter((index) => !state.completed.includes(index));
      if (open.length > 0) return spawnGroup(resumed, open);
    }
    if (option === CHECKPOINT_OPTION.continueBudget && state.last) {
      const span = openSpan(state.last, state.completed);
      return spawn(
        { ...state, exceeded: null, stepIndex: span.stepIndex },
        { ...state.last, escalate: false, reason: 'resume', ...span },
      );
    }
    const limit = (state.exceeded ?? 'time').replace('_', ' ');
    return finish(state, 'failed', budgetStopLine(state, limit));
  }
  if (option === CHECKPOINT_OPTION.stop) return finish(state, 'cancelled', 'You stopped it.');
  if (event.kind === 'needs_input') {
    if (option === CHECKPOINT_OPTION.answer && event.note) return answerAgent(state, event.note);
    return byRules(state, state.fallback ?? { status: 'done', next: 'finish' });
  }
  if (event.kind === 'plan') {
    if (option === CHECKPOINT_OPTION.editPlan) {
      if (state.planEdits >= MAX_PLAN_EDITS) return startBuilding(state);
      return spawn(
        { ...state, planEdits: state.planEdits + 1 },
        { role: 'architect', stepIndex: 0, escalate: false, reason: 'edit', note: event.note },
      );
    }
    return startBuilding(state);
  }
  if (event.kind === 'retry') {
    if (option === CHECKPOINT_OPTION.retry) {
      if (state.suggestion === 'review') return review(state);
      return retry(state, event.note);
    }
    return afterWork({ ...state, reviewed: state.reviewed || state.suggestion === 'review' });
  }
  if (event.kind === 'accept') {
    if (option === CHECKPOINT_OPTION.revert) {
      return { state: { ...state, waitingFor: null }, action: { type: 'revert' } };
    }
    if (option === CHECKPOINT_OPTION.fix) {
      const stepIndex = Math.max(0, state.steps.length - 1);
      return spawn(
        { ...state, stepIndex },
        { role: 'builder', stepIndex, escalate: false, reason: 'fix', note: event.note },
      );
    }
    return finish(state, 'succeeded');
  }
  return finish(state, 'succeeded');
}

export function nextStep(state: FlowState, event: FlowEvent): FlowResult {
  switch (event.type) {
    case 'start':
      if (event.intake === 'interpret') return askInterpretation(state, VAGUE_REASON);
      return event.intake === 'ask'
        ? ask(state, 'clarify', 'Jev is unsure what you meant.', null, true)
        : firstAgent(state);
    case 'clarified':
      return event.depth === null
        ? finish(state, 'cancelled', 'You stopped it.')
        : firstAgent({ ...state, depth: event.depth });
    case 'agent_done':
      return agentDone(state, event);
    case 'judged':
      return judged(state, event);
    case 'answered':
      return answered(state, event);
    case 'wrapped':
      return event.asksToKeep
        ? ask(state, 'accept', filesChangedLine(event.filesChanged))
        : finish(state, 'succeeded');
    case 'reverted':
      return finish(state, 'succeeded', 'Reverted the changes.');
    case 'budget_exceeded':
      return ask(
        { ...withDone(state, event.ticked ?? []), exceeded: event.limit },
        'budget',
        `The ${event.limit.replace('_', ' ')} budget ran out.`,
      );
    case 'group_done':
      return groupDone(state, event);
    case 'stopped':
      return finish(state, 'cancelled', 'Stopped.');
  }
}

function budgetStopLine(state: FlowState, limit: string): string {
  const open = incompleteLine(state);
  const unreviewed =
    reviewWanted(state) && !state.reviewed && state.last?.role === 'builder'
      ? ' The changes so far were not reviewed.'
      : '';
  return `Stopped: the ${limit} budget ran out.${open ? ` ${open}` : ''}${unreviewed}`;
}

function filesChangedLine(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'} changed.`;
}
