import type { ConversationDetail, Orchestration, TaskOverview } from '@spark-outpost/contracts';
import type { CrewAgent } from './crew-model.ts';
import { crewAgents } from './crew-projection.ts';

export function latestOrchestration(detail: ConversationDetail | undefined): Orchestration | null {
  const orchestrations = detail?.orchestrations;
  if (!detail || !orchestrations) return null;
  const run = detail.runs.findLast((candidate) => orchestrations[candidate.id]);
  return run ? orchestrations[run.id]! : null;
}

export function isCrewTurn(orchestration: Orchestration | null | undefined): boolean {
  if (!orchestration) return false;
  const planned = orchestration.depth !== 'direct' && orchestration.depth !== 'execute';
  const child = orchestration.crew.some((member) => member.runId !== orchestration.runId);
  return planned || child || orchestration.crew.length > 1;
}

export function crewOrchestration(detail: ConversationDetail | undefined): Orchestration | null {
  const orchestration = latestOrchestration(detail);
  return isCrewTurn(orchestration) ? orchestration : null;
}

export function lastCrewOrchestration(
  detail: ConversationDetail | undefined,
): Orchestration | null {
  const orchestrations = detail?.orchestrations;
  if (!detail || !orchestrations) return null;
  const run = detail.runs.findLast((candidate) => isCrewTurn(orchestrations[candidate.id]));
  return run ? orchestrations[run.id]! : null;
}

export function tvCrew(detail: ConversationDetail | undefined): CrewAgent[] {
  const orchestration = lastCrewOrchestration(detail);
  return orchestration ? crewAgents(orchestration, detail?.activity) : [];
}

export function conversationCrew(detail: ConversationDetail | undefined): CrewAgent[] {
  const orchestration = crewOrchestration(detail);
  return orchestration ? crewAgents(orchestration, detail?.activity) : [];
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
