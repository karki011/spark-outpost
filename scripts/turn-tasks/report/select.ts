import type { CheckFile, RunRecord } from '../runner/results.ts';

export interface Selected {
  records: RunRecord[];
  checks: CheckFile[];
  leftOut: number;
}

export function selectRuns(
  records: readonly RunRecord[],
  checks: readonly CheckFile[],
  dryRun: boolean,
): Selected {
  const wanted = (item: { live: boolean }) => item.live !== dryRun;
  const kept = records.filter(wanted);
  return {
    records: kept,
    checks: checks.filter(wanted),
    leftOut: records.length - kept.length,
  };
}
