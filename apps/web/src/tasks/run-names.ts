import { providerLabel, type TaskRun } from '@spark-outpost/contracts';

export function runNames(runs: readonly Pick<TaskRun, 'provider'>[]): string[] {
  const seen = new Map<string, number>();
  return runs.map((run) => {
    const agent = providerLabel(run.provider);
    const count = (seen.get(agent) ?? 0) + 1;
    seen.set(agent, count);
    return count > 1 ? `${agent} ${count}` : agent;
  });
}
