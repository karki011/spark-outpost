import type { ActivityStep } from '@spark-outpost/contracts';

export interface StepEventRow {
  run_id: string;
  type: string;
  name: string;
}

export function activityFromEvents(rows: readonly StepEventRow[]): Record<string, ActivityStep[]> {
  const activity: Record<string, ActivityStep[]> = {};
  for (const row of rows) {
    const steps = (activity[row.run_id] ??= []);
    if (row.type === 'STEP_STARTED') {
      steps.push({ name: row.name, done: false });
      continue;
    }
    const open = steps.find((step) => step.name === row.name && !step.done);
    if (open) open.done = true;
  }
  return activity;
}
