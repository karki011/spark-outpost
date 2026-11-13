import {
  providerLabel,
  type SkillSummary,
  type Teammate,
  type WorkflowSummary,
} from '@spark-outpost/contracts';
import type { WorkflowStore } from '../crew-flows/workflow-store.ts';
import type { CrewCandidate } from './similar.ts';
import { sparkFolder } from './spark-skills.ts';

export interface CrewSpark {
  teammate: Teammate;
  skills: SkillSummary[];
}

export async function crewSparks(
  sparksDir: string,
  teammates: readonly Teammate[],
): Promise<CrewSpark[]> {
  return Promise.all(
    teammates.map(async (teammate) => ({
      teammate,
      skills: (await sparkFolder(sparksDir, teammate.id)).skills,
    })),
  );
}

export function sparkLine({ teammate, skills }: CrewSpark) {
  return {
    id: teammate.id,
    name: teammate.name,
    role: teammate.role || null,
    agent: teammate.provider ? providerLabel(teammate.provider) : 'default agent',
    mode: teammate.agentMode ?? 'agent default',
    skills,
  };
}

export function workflowLine(summary: WorkflowSummary, teammates: readonly Teammate[]) {
  const names = new Map(teammates.map((teammate) => [teammate.id, teammate.name]));
  return {
    id: summary.id,
    name: summary.name,
    stages: summary.stages.map((stage) =>
      stage.map((step) => `${step.stepId}: ${names.get(step.sparkId) ?? 'a deleted Spark'}`),
    ),
    ...(summary.problems > 0 ? { problems: summary.problems } : {}),
  };
}

export async function workflowLines(store: WorkflowStore, teammates: readonly Teammate[]) {
  const summaries = await store.list(new Set(teammates.map((teammate) => teammate.id)));
  return summaries.map((summary) => workflowLine(summary, teammates));
}

export function sparkCandidates(
  crew: readonly CrewSpark[],
  exceptId: string | null,
): CrewCandidate[] {
  return crew
    .filter(({ teammate }) => teammate.id !== exceptId)
    .map(({ teammate }) => ({
      kind: 'spark',
      name: teammate.name,
      spark: null,
      description: teammate.role,
    }));
}

export function skillCandidates(crew: readonly CrewSpark[]): CrewCandidate[] {
  return crew.flatMap(({ teammate, skills }) =>
    skills.map((skill): CrewCandidate => ({
      kind: 'skill',
      name: skill.name,
      spark: teammate.name,
      description: skill.description,
    })),
  );
}
