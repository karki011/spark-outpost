import { useMemo } from 'react';
import type { TeammateFace } from '@spark-outpost/contracts';
import type { PickerChoice } from '../ui/ChoicePicker.tsx';
import { useTeammates } from '../teammates/use-teammates.ts';
import { workflowTarget, type SparkName, type StepTarget } from './workflow-model.ts';

export interface CrewSpark {
  id: string;
  name: string;
  role: string;
  face: TeammateFace;
  provider: string | null;
  model: string | null;
  agentMode: string | null;
}

export function useCrewSparks() {
  const { teammates, loading, error } = useTeammates();
  const sparks = useMemo<CrewSpark[]>(
    () =>
      teammates.map(({ id, name, role, face, provider, model, agentMode }) => ({
        id,
        name,
        role,
        face,
        provider,
        model,
        agentMode,
      })),
    [teammates],
  );
  const byId = useMemo(() => new Map(sparks.map((spark) => [spark.id, spark])), [sparks]);
  return { sparks, byId, loading, error };
}

export function stepChoices(
  sparks: readonly CrewSpark[],
  workflows: readonly SparkName[],
): PickerChoice[] {
  return [
    ...sparkChoices(sparks),
    ...workflows.map((workflow) => ({
      id: workflowTarget(workflow.id),
      label: workflow.name,
      description: 'Workflow',
    })),
  ];
}

export function chosenTarget(
  choice: string,
  sparks: ReadonlyMap<string, CrewSpark>,
  workflows: readonly SparkName[],
): StepTarget | null {
  const spark = sparks.get(choice);
  if (spark) return { id: spark.id, name: spark.name };
  const workflow = workflows.find((candidate) => workflowTarget(candidate.id) === choice);
  return workflow ? { id: workflow.id, name: workflow.name, workflow: true } : null;
}

export function sparkChoices(sparks: readonly CrewSpark[]): PickerChoice[] {
  return sparks.map((spark) => ({
    id: spark.id,
    label: spark.name,
    ...(spark.role ? { description: spark.role } : {}),
  }));
}
