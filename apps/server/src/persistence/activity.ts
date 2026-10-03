import { friendlyStep, type ActivityStep } from '@spark-outpost/contracts';

export interface StepEventRow {
  run_id: string;
  type: string;
  name: string;
}

interface OpenQueue {
  steps: ActivityStep[];
  head: number;
}

export function activityFromEvents(rows: readonly StepEventRow[]): Record<string, ActivityStep[]> {
  const activity: Record<string, ActivityStep[]> = {};
  const openByRun = new Map<string, Map<string, OpenQueue>>();
  for (const { name: raw, ...row } of rows) {
    const name = friendlyStep(raw);
    const steps = (activity[row.run_id] ??= []);
    const open = openQueues(openByRun, row.run_id);
    if (row.type === 'STEP_STARTED') {
      const step = { name, done: false };
      steps.push(step);
      enqueue(open, step);
      continue;
    }
    finishOldest(open.get(name));
  }
  return activity;
}

function openQueues(
  openByRun: Map<string, Map<string, OpenQueue>>,
  runId: string,
): Map<string, OpenQueue> {
  let open = openByRun.get(runId);
  if (!open) {
    open = new Map();
    openByRun.set(runId, open);
  }
  return open;
}

function enqueue(open: Map<string, OpenQueue>, step: ActivityStep): void {
  const queue = open.get(step.name);
  if (queue) queue.steps.push(step);
  else open.set(step.name, { steps: [step], head: 0 });
}

function finishOldest(queue: OpenQueue | undefined): void {
  if (!queue || queue.head >= queue.steps.length) return;
  queue.steps[queue.head]!.done = true;
  queue.head += 1;
}
