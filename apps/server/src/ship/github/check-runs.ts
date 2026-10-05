export interface CheckRunFacts {
  name?: string | undefined;
  status: string;
  conclusion: string | null;
}

export type CheckRunsState = 'none' | 'pending' | 'passing' | 'failing';

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

export function failedCheckRuns<T extends CheckRunFacts>(runs: readonly T[]): T[] {
  return runs.filter((run) => run.conclusion !== null && FAILED_CONCLUSIONS.has(run.conclusion));
}

export function checkRunsState(runs: readonly CheckRunFacts[]): CheckRunsState {
  if (runs.length === 0) return 'none';
  if (runs.some((run) => run.status !== 'completed')) return 'pending';
  return failedCheckRuns(runs).length > 0 ? 'failing' : 'passing';
}
