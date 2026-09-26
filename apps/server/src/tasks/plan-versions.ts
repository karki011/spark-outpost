import { PLAN_VERSION_CAP, planChanges, samePlan, type PlanEntry } from '@spark-outpost/contracts';

export interface StoredPlan {
  version: number;
  entries: readonly PlanEntry[];
}

export interface PlanWrite {
  version: number;
  overwrite: boolean;
  supersedesPrevious: boolean;
}

export function nextPlanWrite(
  latest: StoredPlan | null,
  entries: readonly PlanEntry[],
  cap = PLAN_VERSION_CAP,
): PlanWrite | null {
  if (!latest)
    return entries.length > 0 ? { version: 1, overwrite: false, supersedesPrevious: false } : null;
  if (samePlan(latest.entries, entries)) return null;
  if (latest.version >= cap) {
    return { version: latest.version, overwrite: true, supersedesPrevious: false };
  }
  return {
    version: latest.version + 1,
    overwrite: false,
    supersedesPrevious: planChanges(latest.entries, entries).replaced,
  };
}
