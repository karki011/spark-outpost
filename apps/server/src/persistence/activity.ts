import { SPARK_METADATA, friendlyStep, stepMark, type ActivityStep } from '@spark-outpost/contracts';

export interface StepEventRow {
  run_id: string;
  type: string;
  name: string;
  subagent?: boolean;
  mark?: unknown;
  at?: number | string | null;
}

interface OpenQueue {
  steps: ActivityStep[];
  head: number;
}

export function activityFromEvents(rows: readonly StepEventRow[]): Record<string, ActivityStep[]> {
  const activity: Record<string, ActivityStep[]> = {};
  const openByRun = new Map<string, Map<string, OpenQueue>>();
  for (const { name: raw, ...row } of rows) {
    const steps = (activity[row.run_id] ??= []);
    if (row.type === 'REASONING_START') {
      const thinking = steps.at(-1);
      if (thinking && !thinking.done) thinking.reasoningId = raw;
      continue;
    }
    const name = friendlyStep(raw);
    const open = openQueues(openByRun, row.run_id);
    const at = timeOf(row.at);
    if (row.type === 'STEP_STARTED') {
      const step: ActivityStep = {
        name,
        done: false,
        ...(row.subagent ? { subagent: true } : {}),
        ...anchorOf(row.mark),
        ...kindOf(row.mark),
        ...(at === null ? {} : { startedAt: at }),
      };
      steps.push(step);
      enqueue(open, step);
      continue;
    }
    const finished = finishOldest(open.get(name));
    if (finished && at !== null) finished.finishedAt = at;
    const { target } = kindOf(row.mark);
    if (finished && target && !finished.target) finished.target = target;
  }
  return activity;
}

function timeOf(value: StepEventRow['at']): number | null {
  if (value === null || value === undefined) return null;
  const time = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(time) ? time : null;
}

function kindOf(mark: unknown): Pick<ActivityStep, 'toolKind' | 'target'> {
  const { toolKind, target } = stepMark({ metadata: { [SPARK_METADATA]: mark } });
  return { ...(toolKind ? { toolKind } : {}), ...(target ? { target } : {}) };
}

function anchorOf(mark: unknown): Pick<ActivityStep, 'textOffset' | 'textBefore' | 'textHeld'> {
  const { textOffset, textBefore, textHeld } = stepMark({ metadata: { [SPARK_METADATA]: mark } });
  if (textOffset === undefined) return {};
  return {
    textOffset,
    ...(textBefore === undefined ? {} : { textBefore }),
    ...(textHeld === undefined ? {} : { textHeld }),
  };
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

function finishOldest(queue: OpenQueue | undefined): ActivityStep | null {
  if (!queue || queue.head >= queue.steps.length) return null;
  const step = queue.steps[queue.head]!;
  step.done = true;
  queue.head += 1;
  return step;
}
