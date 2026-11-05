import type { ChangeRunSummary, Run } from '@spark-outpost/contracts';

export function offersRevert(
  run: Pick<Run, 'revertedAt'>,
  changed: readonly Pick<ChangeRunSummary, 'runId' | 'files'>[],
  runIds: readonly string[],
): boolean {
  if (run.revertedAt) return true;
  return changed.some((entry) => entry.files > 0 && runIds.includes(entry.runId));
}
