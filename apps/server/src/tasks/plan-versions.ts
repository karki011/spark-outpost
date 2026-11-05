import { PLAN_VERSION_CAP, planChanges, samePlan, type PlanEntry } from '@spark-outpost/contracts';

export interface StoredPlan {
  version: number;
  entries: readonly PlanEntry[];
  sourceRunId?: string | null;
}

export interface PlanWrite {
  version: number;
  overwrite: boolean;
  supersedesPrevious: boolean;
}

function onlyStatusChanged(previous: readonly PlanEntry[], next: readonly PlanEntry[]): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (entry, index) =>
        entry.content === next[index]!.content && entry.priority === next[index]!.priority,
    )
  );
}

export function nextPlanWrite(
  latest: StoredPlan | null,
  entries: readonly PlanEntry[],
  sourceRunId: string | null = null,
  cap = PLAN_VERSION_CAP,
): PlanWrite | null {
  if (!latest)
    return entries.length > 0 ? { version: 1, overwrite: false, supersedesPrevious: false } : null;
  if (samePlan(latest.entries, entries)) return null;
  const sameAuthor = sourceRunId !== null && latest.sourceRunId === sourceRunId;
  if (sameAuthor || onlyStatusChanged(latest.entries, entries) || latest.version >= cap) {
    return { version: latest.version, overwrite: true, supersedesPrevious: false };
  }
  return {
    version: latest.version + 1,
    overwrite: false,
    supersedesPrevious: planChanges(latest.entries, entries).replaced,
  };
}
