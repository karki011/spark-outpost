import { useMemo } from 'react';
import type { TeammateFace } from '@spark-outpost/contracts';
import type { PickerChoice } from '../ui/ChoicePicker.tsx';
import { useTeammates } from '../teammates/use-teammates.ts';

export interface CrewSpark {
  id: string;
  name: string;
  role: string;
  face: TeammateFace;
}

export function useCrewSparks() {
  const { teammates, loading, error } = useTeammates();
  const sparks = useMemo<CrewSpark[]>(
    () => teammates.map(({ id, name, role, face }) => ({ id, name, role, face })),
    [teammates],
  );
  const byId = useMemo(() => new Map(sparks.map((spark) => [spark.id, spark])), [sparks]);
  return { sparks, byId, loading, error };
}

export function sparkChoices(sparks: readonly CrewSpark[]): PickerChoice[] {
  return sparks.map((spark) => ({
    id: spark.id,
    label: spark.name,
    ...(spark.role ? { description: spark.role } : {}),
  }));
}
