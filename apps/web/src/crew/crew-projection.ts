import {
  isTerminalRunStatus,
  type ActivityStep,
  type CrewMember,
  type Orchestration,
} from '@spark-outpost/contracts';
import { timedOut, WAITED_LABEL } from '../chat/approvals/timed-out.ts';
import { handOffAt } from '../chat/crew/crew-items.ts';
import type { CrewAgent, CrewState } from './crew-model.ts';

export const JEV_ID = 'jev';

const RUN_STATES: Record<CrewMember['status'], CrewState> = {
  queued: 'queued',
  running: 'working',
  awaiting_approval: 'waiting',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'stopped',
  outcome_unknown: 'failed',
};

const VERDICT_LINES = { looks_good: 'looks good', concerns: 'has concerns', unclear: 'unclear' };

const PHASE_LINES: Record<Orchestration['phase'], string> = {
  intake: 'read the request',
  scouting: 'answering',
  planning: 'working',
  building: 'handed off the build',
  reviewing: 'asked for a review',
  waiting: 'waiting on you',
  finished: 'ready for you',
};

export function runState(status: CrewMember['status']): CrewState {
  return RUN_STATES[status];
}

export function stepLine(name: string): string {
  const plain = name.replaceAll('`', '').trim();
  return plain.charAt(0).toLowerCase() + plain.slice(1);
}

function handedOff(member: CrewMember, orchestration: Orchestration): boolean {
  return (
    member.runId === orchestration.runId &&
    !isTerminalRunStatus(member.status) &&
    handOffAt(orchestration.crew, orchestration.runId) !== null
  );
}

function memberState(member: CrewMember, orchestration: Orchestration): CrewState {
  if (orchestration.pendingCheckpoint?.runId === member.runId) return 'waiting';
  if (handedOff(member, orchestration)) return 'done';
  if (timedOut(member.error)) return 'stopped';
  const state = RUN_STATES[member.status];
  if (state === 'working' && !member.toolCalls) return 'thinking';
  return state;
}

function memberLine(member: CrewMember, state: CrewState, steps: readonly ActivityStep[]): string {
  if (timedOut(member.error)) return WAITED_LABEL;
  if (state === 'queued') return member.role === 'critic' ? 'queued for review' : 'queued';
  if (state === 'waiting') return 'waiting for you';
  if (state === 'stopped') return 'stopped';
  if (state === 'failed') return 'hit a problem';
  if (state === 'done') {
    return member.verdict ? VERDICT_LINES[member.verdict] : (member.planStep ?? 'done');
  }
  const open = steps.findLast((step) => !step.done);
  if (open) return stepLine(open.name);
  return member.planStep ? stepLine(member.planStep) : 'thinking';
}

export function runAgent(
  member: CrewMember,
  orchestration: Orchestration,
  steps: readonly ActivityStep[] = [],
): CrewAgent {
  const state = memberState(member, orchestration);
  return {
    id: member.runId,
    role: member.role,
    name: member.name,
    provider: member.provider,
    model: member.modelLabel ?? member.model,
    effort: member.effort,
    state,
    line: memberLine(member, state, steps),
    tokens: member.tokens,
    costUsd: member.costUsd,
    costSource: member.costSource,
    durationMs: member.durationMs,
    ...(member.sameProvider ? { sameProvider: true } : {}),
    ...(member.routeNote ? { routeNote: member.routeNote } : {}),
    ...(member.spark ? { spark: { id: member.spark.id, role: member.spark.role } } : {}),
  };
}

function haltedState(orchestration: Orchestration, crew: readonly CrewAgent[]): CrewState | null {
  const crewWaiting = crew.some((agent) => agent.state === 'waiting');
  if (
    orchestration.pendingCheckpoint ||
    orchestration.phase === 'waiting' ||
    orchestration.status === 'awaiting_approval' ||
    crewWaiting
  ) {
    return 'waiting';
  }
  if (orchestration.status === 'succeeded') return 'done';
  if (orchestration.status === 'cancelled' || timedOut(orchestration.error)) return 'stopped';
  if (orchestration.status !== 'running' && orchestration.status !== 'queued') return 'failed';
  return null;
}

function jevState(orchestration: Orchestration, crew: readonly CrewAgent[]): CrewState {
  return haltedState(orchestration, crew) ?? (orchestration.jevAsk ? 'working' : 'done');
}

function jevLine(orchestration: Orchestration, state: CrewState): string {
  if (timedOut(orchestration.error)) return WAITED_LABEL;
  if (state === 'waiting') return 'waiting on you';
  if (state === 'stopped') return 'stopped';
  if (state === 'failed') return 'hit a problem';
  if (state === 'done' && orchestration.status === 'succeeded') return 'ready for you';
  return PHASE_LINES[orchestration.phase];
}

export function jevAgent(orchestration: Orchestration, crew: readonly CrewAgent[]): CrewAgent {
  const state = jevState(orchestration, crew);
  const latency = orchestration.decisions.reduce((sum, item) => sum + (item.latencyMs ?? 0), 0);
  return {
    id: JEV_ID,
    role: 'jev',
    name: 'Jev',
    provider: 'jev',
    model: null,
    effort: null,
    state,
    line: jevLine(orchestration, state),
    tokens: orchestration.decisions.length > 0 ? orchestration.totals.jevTokens : null,
    costUsd: orchestration.decisions.length > 0 ? orchestration.totals.jevCostUsd : null,
    costSource: 'estimated',
    durationMs: orchestration.decisions.length > 0 ? latency : null,
  };
}

function addNullable(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

function mergeAgents(earlier: CrewAgent, later: CrewAgent): CrewAgent {
  return {
    ...later,
    tokens: addNullable(earlier.tokens, later.tokens),
    costUsd: addNullable(earlier.costUsd, later.costUsd),
    costSource:
      earlier.costSource === later.costSource || earlier.costUsd === null
        ? later.costSource
        : 'mixed',
    durationMs: addNullable(earlier.durationMs, later.durationMs),
    turns: (earlier.turns ?? 1) + 1,
  };
}

export function runAgents(
  orchestration: Orchestration,
  activity: Record<string, readonly ActivityStep[]> = {},
): CrewAgent[] {
  return orchestration.crew.map((member) =>
    runAgent(member, orchestration, activity[member.runId] ?? []),
  );
}

export function crewAgents(
  orchestration: Orchestration,
  activity: Record<string, readonly ActivityStep[]> = {},
): CrewAgent[] {
  const byName = new Map<string, CrewAgent>();
  for (const agent of runAgents(orchestration, activity)) {
    const earlier = byName.get(agent.name);
    byName.set(agent.name, earlier ? mergeAgents(earlier, agent) : agent);
  }
  const crew = [...byName.values()];
  return [jevAgent(orchestration, crew), ...crew];
}
