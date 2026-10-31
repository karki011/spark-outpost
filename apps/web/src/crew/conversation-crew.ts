import type {
  ConversationDetail,
  CrewMember,
  Orchestration,
  Run,
  SubagentRow,
  TaskOverview,
} from '@spark-outpost/contracts';
import { topLevelRuns } from '../chat/turns.ts';
import { chatAgent } from './chat-agent.ts';
import type { LeadSteps } from './lead-steps.ts';
import type { CrewAgent } from './crew-model.ts';
import { crewAgents, runAgent } from './crew-projection.ts';

export function latestOrchestration(detail: ConversationDetail | undefined): Orchestration | null {
  const orchestrations = detail?.orchestrations;
  if (!detail || !orchestrations) return null;
  const run = detail.runs.findLast((candidate) => orchestrations[candidate.id]);
  return run ? orchestrations[run.id]! : null;
}

export function sparkMembers(orchestration: Orchestration | null | undefined): CrewMember[] {
  return orchestration?.crew.filter((member) => member.role === 'spark') ?? [];
}

export function isSparkLed(orchestration: Orchestration | null | undefined): boolean {
  return orchestration?.depthSource === 'user' && sparkMembers(orchestration).length > 0;
}

export function isCrewTurn(orchestration: Orchestration | null | undefined): boolean {
  if (!orchestration) return false;
  const planned = orchestration.depth !== 'direct' && orchestration.depth !== 'execute';
  const child = orchestration.crew.some((member) => member.runId !== orchestration.runId);
  return planned || child || orchestration.crew.length > 1;
}

export function storedCrewTurn(orchestration: Orchestration | null | undefined): boolean {
  return isCrewTurn(orchestration) && !isSparkLed(orchestration);
}

export function crewOrchestration(detail: ConversationDetail | undefined): Orchestration | null {
  const orchestration = latestOrchestration(detail);
  return isCrewTurn(orchestration) ? orchestration : null;
}

export function conversationCrew(detail: ConversationDetail | undefined): CrewAgent[] {
  const orchestration = crewOrchestration(detail);
  return orchestration ? crewAgents(orchestration, detail?.activity) : [];
}

export function storedCrew(detail: ConversationDetail | undefined): Orchestration | null {
  const orchestration = latestOrchestration(detail);
  return storedCrewTurn(orchestration) ? orchestration : null;
}

export interface TvSpark {
  member: CrewMember;
  agent: CrewAgent;
}

export interface TvCast {
  run: Run;
  lead: CrewAgent;
  sparks: TvSpark[];
  subagents: readonly SubagentRow[];
}

export function tvCast(
  detail: ConversationDetail | undefined,
  live: LeadSteps = new Map(),
): TvCast | null {
  const run = detail ? topLevelRuns(detail).at(-1) : undefined;
  if (!detail || !run) return null;
  const orchestration = detail.orchestrations?.[run.id];
  const asking = detail.approvals.some(
    (approval) => approval.status === 'pending' && approval.runId === run.id,
  );
  const sparks = orchestration
    ? sparkMembers(orchestration).map((member) => ({
        member,
        agent: runAgent(member, orchestration, detail.activity[member.runId] ?? []),
      }))
    : [];
  const latest = detail.conversation.latestRun;
  const current = latest?.id === run.id ? latest : null;
  const lead = chatAgent(
    run,
    detail.activity[run.id] ?? [],
    asking,
    current?.waitingOn ?? 0,
    current?.background ?? null,
    live.get(run.id) ?? null,
  );
  return { run, lead, sparks, subagents: detail.subagents?.[run.id] ?? [] };
}

export function castAgents(cast: TvCast | null): CrewAgent[] {
  return cast ? [cast.lead, ...cast.sparks.map((spark) => spark.agent)] : [];
}

export function tvCrew(detail: ConversationDetail | undefined): CrewAgent[] {
  return castAgents(tvCast(detail));
}

export function agentAnchor(orchestrationRunId: string, agentId: string): string {
  return agentId === 'jev' ? `agent-jev-${orchestrationRunId}` : `agent-${agentId}`;
}

export function approvalAnchor(approvalId: string): string {
  return `approval-${approvalId}`;
}

export function belongsTo(task: TaskOverview, orchestration: Orchestration): boolean {
  return orchestration.taskId === task.id || task.runIds.includes(orchestration.runId);
}
